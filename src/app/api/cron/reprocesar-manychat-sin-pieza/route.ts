import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirCronSecret } from '@/lib/api-auth'
import { logCronRun } from '@/lib/cron-log'
import {
  buscarPiezaPorCodigo,
  clientePorCuentaManyChat,
  cuentaManyChat,
  errorCodigoSinPieza,
  esCodigoValido,
  extraerContacto,
  marcarLogProcesado,
  registrarChat,
  resolveClassification,
  type Classification,
} from '@/lib/manychat'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// Recupera los chats de ManyChat que el webhook descartó porque su código no
// tenía pieza (H_06_08, R_17_08 y el "{keyword_trigger}" literal del 13-08:
// 681 llamadas de Mane). Uso puntual, se invoca a mano hasta que `quedan`
// llegue a 0:
//
//   select private.call_cron_endpoint('/api/cron/reprocesar-manychat-sin-pieza?dry=1');
//   select private.call_cron_endpoint('/api/cron/reprocesar-manychat-sin-pieza?limite=80');
//
// Por cada log (source manychat, processed=false, error "No content piece..."),
// del más antiguo al más nuevo:
//  - El cliente sale de la cuenta de ManyChat del live_chat_url.
//  - Si hoy ya existe una pieza con ese código, se enlaza su content_id.
//  - La fecha del chat es received_at del log, no hoy: si no, todos esos chats
//    caerían en el día del reproceso.
//  - Clasificación: la que guardó el log si la trae. Los logs viejos no la
//    guardaban y la URL (chat-abierto o la de conversación) no queda en el
//    payload, así que la primera llamada de la persona con ese código cuenta
//    como chat abierto y las siguientes como conversación real, que es lo que
//    hace el flujo de ManyChat (una llamada al abrir y otra al responder).
//  - Deduplica: de 271 personas de septiembre, 154 ya eran leads. Se reutiliza
//    el lead por usuario de Instagram y, si ya hay una interacción con ese
//    código en el mismo instante, el log solo se marca.
//  - No reparte setter ni reatribuye el CTA de leads que ya existían.
//
// Idempotente: cada log procesado queda processed=true, y una interacción con
// el mismo código y la misma fecha no se vuelve a crear.

const LIMITE_POR_DEFECTO = 80
const LIMITE_MAXIMO = 150
const LIMITE_DRY = 1000
const PRESUPUESTO_MS = 45_000
const SIETE_DIAS_MS = 7 * 24 * 3_600_000
const TREINTA_DIAS_MS = 30 * 24 * 3_600_000

interface LogSinPieza {
  id: string
  event_type: string
  payload: Record<string, unknown>
  received_at: string
}

interface InteraccionPrevia {
  id: string
  ig_username: string | null
  keyword_used: string | null
  bot_triggered_at: string
  classification: string | null
}

interface FilaPlan {
  logId: string
  fecha: string
  codigo: string
  igUsername: string
  clasificacion: Classification | null
  accion: 'lead_nuevo' | 'lead_existente' | 'ya_registrado' | 'sin_cliente' | 'sin_identificador'
  interaccion: 'nueva' | 'promueve' | 'ninguna'
  pieza: string | null
}

const clasificacionesValidas: Classification[] = ['chat_abierto', 'conversacion_real', 'lead_calificado', 'disqualified']

function codigoDelLog(log: LogSinPieza): string {
  const delPayload = typeof log.payload.pieceId === 'string' ? log.payload.pieceId : ''
  return delPayload || log.event_type.replace(/^piece:/, '')
}

function claveKeyword(codigo: string | null): string {
  return (codigo ?? '').toLowerCase()
}

export async function GET(request: Request) {
  const noAutorizado = exigirCronSecret(request)
  if (noAutorizado) return noAutorizado

  const url = new URL(request.url)
  const dry = url.searchParams.get('dry') === '1'
  const limitePedido = Number(url.searchParams.get('limite')) || LIMITE_POR_DEFECTO
  const limite = dry ? LIMITE_DRY : Math.min(Math.max(1, limitePedido), LIMITE_MAXIMO)
  const inicio = Date.now()
  const supabase = createAdminClient()

  const { data: logsData, error: errorLogs } = await supabase
    .from('webhook_logs')
    .select('id, event_type, payload, received_at')
    .eq('source', 'manychat')
    .eq('processed', false)
    .like('error', 'No content piece%')
    .order('received_at', { ascending: true })
    .limit(limite)

  if (errorLogs) {
    await logCronRun('reprocesar-manychat-sin-pieza', { fallo: 'no se pudo leer webhook_logs', error: errorLogs.message, dry })
    return NextResponse.json({ error: errorLogs.message }, { status: 500 })
  }

  const { count: pendientesTotal } = await supabase
    .from('webhook_logs')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'manychat')
    .eq('processed', false)
    .like('error', 'No content piece%')

  const logs = (logsData ?? []) as LogSinPieza[]

  // Cliente y pieza por log, con caché por cuenta y por código.
  const clientePorCuenta = new Map<string, string | null>()
  const piezaPorCodigo = new Map<string, { id: string; client_id: string } | null>()
  const clienteDe = new Map<string, string | null>()
  for (const log of logs) {
    const cuenta = cuentaManyChat(log.payload)
    const codigo = codigoDelLog(log)
    if (!piezaPorCodigo.has(codigo)) piezaPorCodigo.set(codigo, await buscarPiezaPorCodigo(supabase, codigo))
    const pieza = piezaPorCodigo.get(codigo) ?? null
    let clientId = pieza?.client_id ?? null
    if (!clientId && cuenta) {
      if (!clientePorCuenta.has(cuenta)) clientePorCuenta.set(cuenta, await clientePorCuentaManyChat(supabase, cuenta))
      clientId = clientePorCuenta.get(cuenta) ?? null
    }
    clienteDe.set(log.id, clientId)
  }

  // Leads e interacciones que ya existen para esas personas, por cliente.
  const leadsExistentes = new Set<string>()
  const interaccionesPrevias = new Map<string, InteraccionPrevia[]>()
  const porCliente = new Map<string, Set<string>>()
  for (const log of logs) {
    const clientId = clienteDe.get(log.id)
    const ig = extraerContacto(log.payload).igUsername
    if (!clientId || !ig) continue
    if (!porCliente.has(clientId)) porCliente.set(clientId, new Set())
    porCliente.get(clientId)!.add(ig)
  }
  for (const [clientId, nombres] of porCliente) {
    const lista = [...nombres]
    for (let i = 0; i < lista.length; i += 100) {
      const tanda = lista.slice(i, i + 100)
      const [leadsRes, interRes] = await Promise.all([
        supabase.from('leads').select('ig_username').eq('client_id', clientId).in('ig_username', tanda),
        supabase
          .from('interactions')
          .select('id, ig_username, keyword_used, bot_triggered_at, classification')
          .eq('client_id', clientId)
          .in('ig_username', tanda),
      ])
      if (leadsRes.error || interRes.error) {
        const msg = (leadsRes.error ?? interRes.error)!.message
        await logCronRun('reprocesar-manychat-sin-pieza', { fallo: 'no se pudo leer leads o interactions', error: msg, dry })
        return NextResponse.json({ error: msg }, { status: 500 })
      }
      for (const l of leadsRes.data ?? []) leadsExistentes.add(`${clientId}|${l.ig_username}`)
      for (const it of (interRes.data ?? []) as InteraccionPrevia[]) {
        const clave = `${clientId}|${it.ig_username}|${claveKeyword(it.keyword_used)}`
        interaccionesPrevias.set(clave, [...(interaccionesPrevias.get(clave) ?? []), it])
      }
    }
  }

  const plan: FilaPlan[] = []
  const errores: { logId: string; error: string }[] = []
  let procesados = 0
  let leadsNuevos = 0
  let interaccionesNuevas = 0
  let promovidas = 0
  let yaRegistrados = 0
  let sinCliente = 0
  let cortePorTiempo = false

  for (const log of logs) {
    if (!dry && Date.now() - inicio > PRESUPUESTO_MS) {
      cortePorTiempo = true
      break
    }

    const codigo = codigoDelLog(log)
    const contacto = extraerContacto(log.payload)
    const clientId = clienteDe.get(log.id) ?? null
    const pieza = piezaPorCodigo.get(codigo) ?? null
    const keyword = esCodigoValido(codigo) ? codigo : null
    const fila: FilaPlan = {
      logId: log.id,
      fecha: log.received_at,
      codigo,
      igUsername: contacto.igUsername,
      clasificacion: null,
      accion: 'sin_cliente',
      interaccion: 'ninguna',
      pieza: pieza?.id ?? null,
    }

    if (!contacto.igUsername) {
      fila.accion = 'sin_identificador'
      plan.push(fila)
      continue
    }
    if (!clientId) {
      sinCliente++
      plan.push(fila)
      continue
    }

    const clave = `${clientId}|${contacto.igUsername}|${claveKeyword(keyword)}`
    const previas = interaccionesPrevias.get(clave) ?? []
    const momento = new Date(log.received_at).toISOString()
    const tMomento = new Date(momento).getTime()

    // Ya registrado (una corrida anterior que no alcanzó a marcar el log).
    if (previas.some((p) => new Date(p.bot_triggered_at).getTime() === tMomento)) {
      fila.accion = 'ya_registrado'
      yaRegistrados++
      plan.push(fila)
      if (!dry) {
        await marcarLogProcesado(supabase, log.id, { leadId: null, error: pieza ? null : errorCodigoSinPieza(codigo) })
        procesados++
      }
      continue
    }

    const guardada = log.payload.clasificacion as Classification | undefined
    const huboAntes = previas.some((p) => {
      const t = new Date(p.bot_triggered_at).getTime()
      return t < tMomento && tMomento - t <= SIETE_DIAS_MS
    })
    const clasificacion: Classification = guardada && clasificacionesValidas.includes(guardada)
      ? guardada
      : huboAntes
        ? 'conversacion_real'
        : resolveClassification(log.payload)
    fila.clasificacion = clasificacion
    const leadExiste = leadsExistentes.has(`${clientId}|${contacto.igUsername}`)
    fila.accion = leadExiste ? 'lead_existente' : 'lead_nuevo'
    fila.interaccion = clasificacion !== 'chat_abierto' && huboAntes ? 'promueve' : 'nueva'
    plan.push(fila)

    // Lo que dejaría esta fila, para que la siguiente de la misma persona lo
    // vea también en el dry-run (donde no se escribe nada).
    const registrar = () => {
      leadsExistentes.add(`${clientId}|${contacto.igUsername}`)
      if (fila.interaccion === 'nueva') {
        interaccionesPrevias.set(clave, [
          ...previas,
          { id: 'simulada', ig_username: contacto.igUsername, keyword_used: keyword, bot_triggered_at: momento, classification: clasificacion },
        ])
      }
    }

    if (dry) {
      if (!leadExiste) leadsNuevos++
      if (fila.interaccion === 'nueva') interaccionesNuevas++
      else promovidas++
      registrar()
      continue
    }

    try {
      const r = await registrarChat(supabase, {
        clientId,
        contentId: pieza?.id ?? null,
        codigo,
        contacto,
        classification: clasificacion,
        momento,
      })
      if (r.leadNuevo) leadsNuevos++
      if (r.interaccionNueva) interaccionesNuevas++
      else promovidas++
      fila.accion = r.leadNuevo ? 'lead_nuevo' : 'lead_existente'
      fila.interaccion = r.interaccionNueva ? 'nueva' : 'promueve'
      registrar()
      await marcarLogProcesado(supabase, log.id, {
        leadId: r.leadId,
        error: pieza ? null : errorCodigoSinPieza(codigo),
      })
      procesados++
    } catch (e) {
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'Error desconocido'
      errores.push({ logId: log.id, error: msg })
    }
  }

  // Leads que nacerían con más de 30 días y un solo toque: prune-stale-leads
  // los borraría esa misma noche. Se informa para decidir antes de correrlo.
  const personasNuevas = new Map<string, FilaPlan[]>()
  for (const f of plan) {
    if (f.accion !== 'lead_nuevo') continue
    personasNuevas.set(f.igUsername, [...(personasNuevas.get(f.igUsername) ?? []), f])
  }
  const leadsNuevosPodables = [...personasNuevas.values()].filter((filas) =>
    filas.length === 1 && Date.now() - new Date(filas[0].fecha).getTime() > TREINTA_DIAS_MS
  ).length

  const resumen = {
    dry,
    leidos: logs.length,
    pendientesAntes: pendientesTotal ?? null,
    procesados,
    leadsNuevos,
    interaccionesNuevas,
    promovidas,
    yaRegistrados,
    sinCliente,
    leadsNuevosQueBorrariaPruneStaleLeads: leadsNuevosPodables,
    cortePorTiempo,
    quedan: dry ? pendientesTotal ?? null : Math.max(0, (pendientesTotal ?? 0) - procesados),
    ...(errores.length > 0 && { errores: errores.slice(0, 20) }),
  }
  await logCronRun('reprocesar-manychat-sin-pieza', resumen)

  if (!dry) return NextResponse.json(resumen)

  // Dry-run: personas y fechas, agrupadas por código.
  const porCodigo = new Map<string, { codigo: string; llamadas: number; personas: Map<string, { accion: string; fechas: string[]; clasificaciones: string[] }> }>()
  for (const f of plan) {
    const g = porCodigo.get(f.codigo) ?? { codigo: f.codigo, llamadas: 0, personas: new Map() }
    g.llamadas++
    const p = g.personas.get(f.igUsername) ?? { accion: f.accion, fechas: [], clasificaciones: [] }
    p.fechas.push(f.fecha)
    if (f.clasificacion) p.clasificaciones.push(f.clasificacion)
    g.personas.set(f.igUsername, p)
    porCodigo.set(f.codigo, g)
  }

  return NextResponse.json({
    ...resumen,
    codigos: [...porCodigo.values()].map((g) => ({
      codigo: g.codigo,
      llamadas: g.llamadas,
      personas: g.personas.size,
      detalle: [...g.personas.entries()].map(([ig, p]) => ({ ig, ...p })),
    })),
  })
}
