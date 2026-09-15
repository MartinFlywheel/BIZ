import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logCronRun } from '@/lib/cron-log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// Insights diarios de la cuenta de Instagram de cada cliente, guardados en
// ig_account_daily_insights (supabase/073).
//
// Por qué existe: las vistas de cada historia solo se pueden pedir mientras la
// historia está viva (24 h). Todas las de julio a septiembre de 2026 quedaron
// en 0 por un error del cron de historias y ya no se recuperan una por una.
// Los insights a nivel de cuenta sí guardan historial: `views` con
// breakdown=media_product_type trae las vistas de STORY/REEL/POST/CAROUSEL de
// cada día, y `follows_and_unfollows` con breakdown=follow_type trae los
// seguidores nuevos. El Registro de métricas lee de aquí VIEWS HISTORIAS y
// SEGUIDORES +.
//
// Modos:
//   - Sin parámetros (pg_cron, una vez al día): vuelve a pedir los últimos 3
//     días completos del Pacífico, porque Meta asienta los números en 24-48 h,
//     y guarda la foto de followers_count en la fila de hoy.
//   - ?since=YYYY-MM-DD&until=YYYY-MM-DD: rellena historia, 15 días como
//     máximo por llamada para no pasarse de los 60 s de Vercel Hobby.
//   - &dry=1: pide todo a Meta y devuelve lo que escribiría, sin escribir.
//
// Idempotente: upsert por (client_id, day). Correrla dos veces deja lo mismo.

const MAX_DIAS_POR_LLAMADA = 15
const DIAS_A_REFRESCAR = 3
const CONCURRENCIA = 8
const TIMEOUT_META_MS = 15_000
const ZONA_META = 'America/Los_Angeles'
const JOB = 'sync-instagram-insights'

// PostgREST responde 42P01 o PGRST205 (según la versión) cuando la tabla no
// existe: la 073 todavía no se aplicó.
const TABLA_INEXISTENTE = ['42P01', 'PGRST205']

// ── Fechas del Pacífico ─────────────────────────────────────────────────────
// Meta agrupa los insights de cuenta por día calendario del Pacífico, con
// cambio de horario incluido, así que la medianoche se calcula con la zona y
// no con un offset fijo.

const formatoPacifico = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA_META,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function relojPacifico(instanteMs: number) {
  const partes = formatoPacifico.formatToParts(new Date(instanteMs))
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value)
  return {
    dia: `${valor('year')}-${String(valor('month')).padStart(2, '0')}-${String(valor('day')).padStart(2, '0')}`,
    hora: valor('hour'),
    minuto: valor('minute'),
    segundo: valor('second'),
    comoUtcMs: Date.UTC(valor('year'), valor('month') - 1, valor('day'), valor('hour'), valor('minute'), valor('second')),
  }
}

function hoyPacifico(): string {
  return relojPacifico(Date.now()).dia
}

function sumarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Unix (segundos) de las 00:00 del día `dia` en hora del Pacífico. */
function medianochePacifico(dia: string): number {
  const [y, m, d] = dia.split('-').map(Number)
  const supuesto = Date.UTC(y, m - 1, d)
  let instante = supuesto - (relojPacifico(supuesto).comoUtcMs - supuesto)
  // Segunda pasada con el offset del instante encontrado, por si el supuesto
  // cayó al otro lado de un cambio de horario.
  instante = supuesto - (relojPacifico(instante).comoUtcMs - instante)

  const reloj = relojPacifico(instante)
  if (reloj.dia !== dia || reloj.hora !== 0 || reloj.minuto !== 0 || reloj.segundo !== 0) {
    throw new Error(`no se pudo calcular la medianoche del Pacífico de ${dia}`)
  }
  return Math.floor(instante / 1000)
}

// ── Ventana de un día ───────────────────────────────────────────────────────
// REGLA EMPÍRICA (Graph API v25.0, verificada a mano el 2026-09-14; Meta no la
// documenta): con metric_type=total_value, `since` sube a la medianoche del
// Pacífico siguiente y `until` se extiende hasta el fin del día del Pacífico
// que lo contiene. Para pedir un solo día D se usa since = D 00:00 PT y
// until = since + 1 h. Si until cayera justo en la medianoche siguiente, Meta
// sumaría también ese día.
//
// Como la regla puede cambiar sin aviso, cada corrida la comprueba (ver
// comprobarVentana): si la ventana de dos días no da la suma de los dos días
// sueltos, no se escribe nada de ese cliente y el motivo queda en cron_runs.

function ventanaDeUnDia(dia: string): { since: number; until: number } {
  const since = medianochePacifico(dia)
  return { since, until: since + 3600 }
}

interface Resultado {
  name?: string
  total_value?: {
    value?: number
    breakdowns?: { results?: { dimension_values?: string[]; value?: number }[] }[]
  }
}

// GET a Graph con el token al final. Nunca lanza, y el token se tacha de
// cualquier texto de error antes de que llegue a la consola o a cron_runs.
async function pedirJson(url: string, token: string): Promise<{ json: Record<string, unknown> | null; error: string | null }> {
  try {
    const separador = url.includes('?') ? '&' : '?'
    const res = await fetch(`${url}${separador}access_token=${token}`, { signal: AbortSignal.timeout(TIMEOUT_META_MS) })
    if (!res.ok) {
      const cuerpo = (await res.text()).slice(0, 300)
      return { json: null, error: `HTTP ${res.status}: ${cuerpo.replaceAll(token, '***')}` }
    }
    return { json: (await res.json()) as Record<string, unknown>, error: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { json: null, error: msg.replaceAll(token, '***') }
  }
}

async function pedirMeta(url: string, token: string): Promise<{ data: Resultado[] | null; error: string | null }> {
  const { json, error } = await pedirJson(url, token)
  if (error || !json) return { data: null, error: error ?? 'respuesta vacía' }
  return { data: (json.data ?? []) as Resultado[], error: null }
}

async function pedirFollowersCount(igId: string, token: string): Promise<{ total: number | null; error: string | null }> {
  const { json, error } = await pedirJson(`https://graph.facebook.com/${igId}?fields=followers_count`, token)
  if (error || !json) return { total: null, error: error ?? 'respuesta vacía' }
  return typeof json.followers_count === 'number'
    ? { total: json.followers_count, error: null }
    : { total: null, error: 'Meta no devolvió followers_count' }
}

// null = Meta todavía no tiene el dato de ese día. Se vio el 2026-09-14 con
// follows_and_unfollows del 13-09: la respuesta trae `dimension_keys` pero no
// `results`, mientras que un día sin movimiento trae results con value 0.
// Guardar ese hueco como 0 dejaría "0 seguidores" hasta la corrida siguiente.
function porDimension(resultado: Resultado | undefined): Record<string, number> | null {
  const results = resultado?.total_value?.breakdowns?.[0]?.results
  if (!results) return null
  const valores: Record<string, number> = {}
  for (const r of results) {
    const clave = r.dimension_values?.[0]
    if (clave) valores[clave] = Number(r.value) || 0
  }
  return valores
}

interface Vistas {
  views_story: number
  views_reel: number
  views_post: number
  views_carousel: number
  views_total: number
}

interface Seguidores {
  follows: number
  unfollows: number
}

async function pedirVistas(igId: string, dia: string, token: string): Promise<{ vistas: Vistas | null; error: string | null; pendiente?: boolean }> {
  const { since, until } = ventanaDeUnDia(dia)
  const { data, error } = await pedirMeta(
    `https://graph.facebook.com/${igId}/insights?metric=views&period=day&metric_type=total_value&breakdown=media_product_type&since=${since}&until=${until}`,
    token,
  )
  if (error || !data) return { vistas: null, error: error ?? 'respuesta vacía' }
  const resultado = data.find((r) => r.name === 'views')
  if (!resultado) return { vistas: null, error: 'Meta no devolvió la métrica views' }
  const d = porDimension(resultado)
  if (!d) return { vistas: null, error: null, pendiente: true }
  const suma = Object.values(d).reduce((s, v) => s + v, 0)
  return {
    vistas: {
      // Un tipo ausente en el desglose es un día sin vistas de ese tipo: la
      // llamada salió bien, así que es 0 y no "sin dato".
      views_story: d.STORY ?? 0,
      views_reel: d.REEL ?? 0,
      views_post: d.POST ?? 0,
      views_carousel: d.CAROUSEL_CONTAINER ?? 0,
      views_total: Number(resultado.total_value?.value ?? suma) || 0,
    },
    error: null,
  }
}

async function pedirSeguidores(igId: string, dia: string, token: string): Promise<{ seguidores: Seguidores | null; error: string | null; pendiente?: boolean }> {
  const { since, until } = ventanaDeUnDia(dia)
  const { data, error } = await pedirMeta(
    `https://graph.facebook.com/${igId}/insights?metric=follows_and_unfollows&period=day&metric_type=total_value&breakdown=follow_type&since=${since}&until=${until}`,
    token,
  )
  if (error || !data) return { seguidores: null, error: error ?? 'respuesta vacía' }
  const resultado = data.find((r) => r.name === 'follows_and_unfollows')
  if (!resultado) return { seguidores: null, error: 'Meta no devolvió follows_and_unfollows' }
  const d = porDimension(resultado)
  if (!d) return { seguidores: null, error: null, pendiente: true }
  return { seguidores: { follows: d.FOLLOWER ?? 0, unfollows: d.NON_FOLLOWER ?? 0 }, error: null }
}

/**
 * Chequeo defensivo de la regla de ventanas: pide el total de vistas de dos
 * días seguidos en una sola ventana y lo compara con la suma de los dos días
 * pedidos por separado. Si Meta cambió cómo interpreta since/until, un día
 * suelto traería 0 o 2 días y la suma no cuadra.
 *
 * La tolerancia cubre que Meta sigue asentando números entre una llamada y
 * otra (se vio 6.350 y minutos después 6.406 para el mismo día).
 */
async function comprobarVentana(
  igId: string,
  diaA: string,
  diaB: string,
  totalA: number,
  totalB: number,
  token: string,
): Promise<string | null> {
  const since = medianochePacifico(diaA)
  const until = medianochePacifico(diaB) + 3600
  const { data, error } = await pedirMeta(
    `https://graph.facebook.com/${igId}/insights?metric=views&period=day&metric_type=total_value&since=${since}&until=${until}`,
    token,
  )
  if (error || !data) return `no se pudo comprobar la regla de ventanas: ${error ?? 'respuesta vacía'}`
  const juntos = Number(data.find((r) => r.name === 'views')?.total_value?.value) || 0
  const esperado = totalA + totalB
  const tolerancia = Math.max(50, Math.round(esperado * 0.02))
  if (Math.abs(juntos - esperado) > tolerancia) {
    return `la regla de ventanas de Meta no se cumple: ${diaA}+${diaB} por separado = ${esperado}, juntos = ${juntos}`
  }
  return null
}

async function enParalelo<T, R>(items: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(items.length)
  let siguiente = 0
  async function trabajador() {
    while (siguiente < items.length) {
      const i = siguiente++
      resultados[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador))
  return resultados
}

function esDia(valor: string | null): valor is string {
  return !!valor && /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(Date.parse(`${valor}T12:00:00Z`))
}

type Fila = Record<string, unknown> & { client_id: string; day: string }

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = process.env.META_SYSTEM_USER_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'META_SYSTEM_USER_TOKEN not configured' }, { status: 500 })
  }

  const params = request.nextUrl.searchParams
  const dry = params.get('dry') === '1'
  const sinceParam = params.get('since')
  const untilParam = params.get('until')
  const relleno = sinceParam !== null || untilParam !== null

  // Días completos del Pacífico: el día en curso nunca se guarda con vistas,
  // porque quedaría con un número parcial todo el día y taparía las vistas de
  // las historias vivas, que el cron de historias refresca cada 2 h.
  const ayer = sumarDias(hoyPacifico(), -1)
  const dias: string[] = []

  if (relleno) {
    if (!esDia(sinceParam) || !esDia(untilParam) || sinceParam > untilParam) {
      return NextResponse.json({ error: 'since y until deben ser fechas YYYY-MM-DD con since <= until' }, { status: 400 })
    }
    const hasta = untilParam > ayer ? ayer : untilParam
    for (let d = sinceParam; d <= hasta; d = sumarDias(d, 1)) dias.push(d)
    if (dias.length > MAX_DIAS_POR_LLAMADA) {
      return NextResponse.json(
        { error: `máximo ${MAX_DIAS_POR_LLAMADA} días por llamada; pediste ${dias.length}. Divide el rango en tramos.` },
        { status: 400 },
      )
    }
  } else {
    for (let i = DIAS_A_REFRESCAR; i >= 1; i--) dias.push(sumarDias(hoyPacifico(), -i))
  }

  const supabase = createAdminClient()

  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, ig_account_id, ig_handle')
    .eq('status', 'active')
    .not('ig_account_id', 'is', null)

  if (clientsError) {
    await logCronRun(JOB, { clientes: 0, dry, error: `no se pudieron leer los clientes: ${clientsError.message}` })
    return NextResponse.json({ error: clientsError.message }, { status: 500 })
  }

  if (!clients || clients.length === 0) {
    await logCronRun(JOB, { clientes: 0, dry, motivo: 'sin clientes activos con Instagram conectado' })
    return NextResponse.json({ status: 'no_clients_with_ig' })
  }

  const hoy = hoyPacifico()
  const filasPorEscribir: Fila[] = []
  const errores: { cliente: string; dia?: string; error: string }[] = []
  const clientesOmitidos: string[] = []
  // Días que Meta todavía no tiene listos (sin `results`): no se escriben y la
  // corrida del día siguiente los vuelve a pedir.
  let datosPendientes = 0

  for (const client of clients) {
    const igId = client.ig_account_id as string
    const handle = (client.ig_handle as string | null) ?? igId

    const porDia = await enParalelo(dias, CONCURRENCIA, async (dia) => {
      const [v, s] = await Promise.all([pedirVistas(igId, dia, token), pedirSeguidores(igId, dia, token)])
      return {
        dia,
        vistas: v.vistas,
        seguidores: s.seguidores,
        errorVistas: v.error,
        errorSeguidores: s.error,
        pendientes: (v.pendiente ? 1 : 0) + (s.pendiente ? 1 : 0),
      }
    })

    for (const r of porDia) {
      datosPendientes += r.pendientes
      if (r.errorVistas) errores.push({ cliente: handle, dia: r.dia, error: `views: ${r.errorVistas}` })
      // follows_and_unfollows exige 100 seguidores o más: en una cuenta chica
      // falla siempre y no debe impedir guardar las vistas.
      if (r.errorSeguidores) errores.push({ cliente: handle, dia: r.dia, error: `follows: ${r.errorSeguidores}` })
    }

    // Chequeo de la regla de ventanas con los dos últimos días que sí
    // trajeron vistas. Si no cuadra, ese cliente no se escribe.
    const conVistas = porDia.filter((r) => r.vistas)
    if (conVistas.length >= 2) {
      const a = conVistas[conVistas.length - 2]
      const b = conVistas[conVistas.length - 1]
      if (sumarDias(a.dia, 1) === b.dia) {
        const problema = await comprobarVentana(igId, a.dia, b.dia, a.vistas!.views_total, b.vistas!.views_total, token)
        if (problema) {
          errores.push({ cliente: handle, error: problema })
          clientesOmitidos.push(handle)
          continue
        }
      }
    }

    const fetchedAt = new Date().toISOString()
    for (const r of porDia) {
      // Solo se escriben las partes que Meta entregó: si falló una de las dos
      // llamadas, la otra no pisa con NULL lo que ya estaba guardado.
      if (!r.vistas && !r.seguidores) continue
      filasPorEscribir.push({
        client_id: client.id as string,
        day: r.dia,
        ...(r.vistas ?? {}),
        ...(r.seguidores ?? {}),
        fetched_at: fetchedAt,
      })
    }

    // La foto del total de seguidores solo existe para hoy: no hay historial.
    if (!relleno) {
      const { total, error } = await pedirFollowersCount(igId, token)
      if (error || total === null) {
        errores.push({ cliente: handle, dia: hoy, error: `followers_count: ${error ?? 'sin dato'}` })
      } else {
        filasPorEscribir.push({ client_id: client.id as string, day: hoy, followers_count: total, fetched_at: fetchedAt })
      }
    }
  }

  // Se agrupan por conjunto de columnas: un upsert de varias filas con
  // columnas distintas rellena con NULL las que faltan y pisaría datos buenos
  // (por ejemplo, followers_count al volver a pedir las vistas de ese día).
  const grupos = new Map<string, Fila[]>()
  for (const fila of filasPorEscribir) {
    const firma = Object.keys(fila).sort().join(',')
    grupos.set(firma, [...(grupos.get(firma) ?? []), fila])
  }

  let escritas = 0
  let erroresDeEscritura = 0
  let falta073 = false

  if (!dry) {
    for (const filas of grupos.values()) {
      const { error } = await supabase
        .from('ig_account_daily_insights')
        .upsert(filas, { onConflict: 'client_id,day' })
      if (error) {
        if (TABLA_INEXISTENTE.includes(error.code ?? '')) {
          falta073 = true
          break
        }
        console.error(`[${JOB}] no se pudieron guardar ${filas.length} filas: ${error.message}`)
        errores.push({ cliente: '-', error: `escritura: ${error.message}` })
        erroresDeEscritura += filas.length
        continue
      }
      escritas += filas.length
    }
  }

  const resumen = {
    modo: relleno ? 'relleno' : 'diario',
    dry,
    desde: dias[0] ?? null,
    hasta: dias[dias.length - 1] ?? null,
    dias: dias.length,
    clientes: clients.length,
    clientesOmitidosPorReglaDeVentana: clientesOmitidos,
    filas: filasPorEscribir.length,
    escritas,
    erroresDeEscritura,
    datosPendientes,
    erroresDeMeta: errores.length,
    errores: errores.slice(0, 20),
    ...(falta073 && { motivo: 'falta 073: la tabla ig_account_daily_insights no existe; aplica supabase/073-insights-diarios-de-instagram.sql' }),
  }

  await logCronRun(JOB, resumen)

  // 200 aunque falte la migración: pg_cron no tiene a quién avisarle y el
  // motivo ya quedó en cron_runs.
  return NextResponse.json(dry ? { ...resumen, filasPorEscribir } : resumen)
}
