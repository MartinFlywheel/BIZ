import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logCronRun } from '@/lib/cron-log'
import { fetchAllRows } from '@/lib/supabase/paginate'
import {
  caducidadCdn,
  codigoPermalink,
  elegirPortada,
  esCdnMeta,
  esPortadaGuardada,
  esVideo,
  guardarPortada,
  idPortadaManual,
  listarMediosDeCuenta,
  type MedioDeCuenta,
} from '@/lib/services/portadas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// Pasa a Storage las portadas de content_pieces que todavía dependen de una
// URL firmada del CDN de Meta (o que no tienen ninguna). Uso puntual: desde
// que los syncs guardan la portada al verla, esto solo pone al día lo que
// quedó de antes. Se invoca a mano, varias veces, hasta que `quedan` llegue
// a 0:
//
//   select private.call_cron_endpoint('/api/cron/backfill-portadas?dry=1');
//   select private.call_cron_endpoint('/api/cron/backfill-portadas?limite=30');
//
// Por cada pieza, en este orden:
//  (a) si la URL del CDN sigue vigente (oe > ahora), se descarga y se guarda;
//  (b) si no, y es un medio real de Instagram (reel, post o historia todavía
//      viva), se pide GET /{ig_media_id} para obtener una URL nueva;
//  (c) si es manual con permalink de reel o post, se busca el medio por su
//      código corto en /media paginado y se guarda su portada. No se enlaza
//      la fila (no se escribe ig_media_id): R_23_07 apunta al mismo reel que
//      otra fila ya sincronizada, y el sync del botón pisa caption y permalink
//      de las filas enlazadas. El cron diario enlaza por permalink cuando
//      corresponde;
//  (d) si nada funcionó y la URL guardada ya no sirve (caducada o mp4), queda
//      en NULL para que la interfaz muestre el motivo en vez de una imagen
//      rota. Una historia vencida no se puede recuperar: la API responde
//      code 100 / subcode 33.
//
// Primero van las que caducan antes: las URLs de CDN vigentes se pierden para
// siempre si no se guardan a tiempo.
//
// Idempotente: una pieza con portada en Storage ya no es candidata, y cada
// escritura exige que ig_thumbnail_url siga siendo el valor leído, así que no
// pisa lo que un sync haya guardado mientras tanto.

const LIMITE_POR_DEFECTO = 30
const LIMITE_MAXIMO = 100
// Pasado este tiempo no se empieza otra tanda. Holgado a propósito: una tanda
// puede tardar hasta ~18 s si las descargas agotan su timeout, y
// private.call_cron_endpoint corta la espera de pg_net a los 30 s (la
// respuesta ya no llega a net._http_response, aunque cron_runs sí la guarda).
const PRESUPUESTO_MS = 20_000
const CONCURRENCIA = 5
// Una URL que caduca en menos de esto se trata como caducada: no alcanza a
// descargarse con seguridad.
const MARGEN_CDN_MS = 5 * 60 * 1000
const MAX_MEDIOS_BUSQUEDA = 500

interface Pieza {
  id: string
  client_id: string
  content_type: string
  ig_media_id: string | null
  ig_permalink: string | null
  ig_thumbnail_url: string | null
  story_expires_at: string | null
  published_at: string | null
  keyword_trigger: string | null
}

type Paso = 'cdn' | 'graph' | 'permalink'

interface Plan {
  pieza: Pieza
  pasos: Paso[]
  // La URL actual ya no sirve para nada: si ningún paso funciona se deja NULL.
  urlMuerta: boolean
  caduca: Date | null
  motivoSinRecuperacion: string | null
}

function esMedioReal(mediaId: string | null): mediaId is string {
  // Las filas de Apify sin id real llevan un 'ext_<timestamp>' inventado.
  return !!mediaId && !mediaId.startsWith('ext_')
}

function planificar(pieza: Pieza, ahora: number): Plan {
  const url = pieza.ig_thumbnail_url
  const caduca = caducidadCdn(url)
  const cdnVigente = !!url && !esVideo(url) && esCdnMeta(url) && (!caduca || caduca.getTime() > ahora + MARGEN_CDN_MS)
  const urlMuerta = !!url && (esVideo(url) || (!!caduca && caduca.getTime() <= ahora + MARGEN_CDN_MS))

  const pasos: Paso[] = []
  if (cdnVigente) pasos.push('cdn')

  if (pieza.content_type === 'story') {
    const viva = !!pieza.story_expires_at && new Date(pieza.story_expires_at).getTime() > ahora
    if (esMedioReal(pieza.ig_media_id) && viva) pasos.push('graph')
  } else if (esMedioReal(pieza.ig_media_id)) {
    pasos.push('graph')
  } else if (!pieza.ig_media_id && codigoPermalink(pieza.ig_permalink)) {
    pasos.push('permalink')
  }

  let motivoSinRecuperacion: string | null = null
  if (pasos.length === 0 && !urlMuerta) {
    motivoSinRecuperacion = pieza.content_type === 'story'
      ? (pieza.ig_media_id ? 'historia vencida sin portada' : 'historia manual sin portada')
      : 'pieza manual sin permalink de reel o post'
  }
  return { pieza, pasos, urlMuerta, caduca, motivoSinRecuperacion }
}

// Menor primero. Las URLs vigentes que caducan antes van adelante; después
// las historias vivas; después el resto.
function prioridad(plan: Plan): number {
  if (plan.pasos[0] === 'cdn') return plan.caduca ? plan.caduca.getTime() : Number.MAX_SAFE_INTEGER - 3
  if (plan.pieza.content_type === 'story' && plan.pasos.includes('graph')) return Number.MAX_SAFE_INTEGER - 2
  if (plan.pasos.includes('graph')) return Number.MAX_SAFE_INTEGER - 1
  return Number.MAX_SAFE_INTEGER
}

async function portadaPorGraph(mediaId: string, token: string): Promise<{ url: string | null; error: string | null }> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${mediaId}?fields=media_type,media_url,thumbnail_url&access_token=${token}`,
      { signal: AbortSignal.timeout(10000) }
    )
    const data = await res.json()
    if (!res.ok) {
      const e = data?.error
      return { url: null, error: `code ${e?.code ?? res.status}${e?.error_subcode ? `/${e.error_subcode}` : ''}` }
    }
    const url = elegirPortada(data)
    return { url, error: url ? null : 'la API no trajo imagen' }
  } catch (err) {
    return { url: null, error: err instanceof Error ? err.message : 'error de red' }
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const inicio = Date.now()
  const params = new URL(request.url).searchParams
  const dry = params.get('dry') === '1'
  const limiteParam = Number(params.get('limite'))
  const limite = Number.isFinite(limiteParam) && limiteParam > 0 ? Math.min(Math.floor(limiteParam), LIMITE_MAXIMO) : LIMITE_POR_DEFECTO

  const token = process.env.META_SYSTEM_USER_TOKEN
  const supabase = createAdminClient()

  let piezas: Pieza[]
  try {
    piezas = await fetchAllRows<Pieza>((from, to) =>
      supabase
        .from('content_pieces')
        .select('id, client_id, content_type, ig_media_id, ig_permalink, ig_thumbnail_url, story_expires_at, published_at, keyword_trigger')
        .order('id', { ascending: true })
        .range(from, to)
    )
  } catch (err) {
    const error = err instanceof Error ? err.message : 'no se pudieron leer las piezas'
    await logCronRun('backfill-portadas', { dry, error })
    return NextResponse.json({ error }, { status: 500 })
  }

  // Candidatas: sin portada guardada, y con una URL que caduca (CDN de Meta),
  // un mp4 o nada. Una imagen pegada a mano desde otro sitio no caduca y se
  // deja tal cual.
  const candidatas = piezas.filter((p) => {
    const url = p.ig_thumbnail_url
    if (esPortadaGuardada(url)) return false
    return !url || esVideo(url) || esCdnMeta(url)
  })

  const planes = candidatas.map((p) => planificar(p, inicio)).sort((a, b) => prioridad(a) - prioridad(b))
  const conRed = planes.filter((p) => p.pasos.length > 0)
  const soloAnular = planes.filter((p) => p.pasos.length === 0 && p.urlMuerta)
  const sinRecuperacion = planes.filter((p) => p.motivoSinRecuperacion)

  const resumenPlan = (p: Plan) => ({
    id: p.pieza.id,
    cliente: p.pieza.client_id,
    tipo: p.pieza.content_type,
    codigo: p.pieza.keyword_trigger,
    ig_media_id: p.pieza.ig_media_id,
    pasos: p.pasos,
    anularSiFalla: p.urlMuerta,
    caducaCdn: p.caduca?.toISOString() ?? null,
  })

  if (dry) {
    const urgentes = conRed
      .filter((p) => p.pasos[0] === 'cdn' && p.caduca && p.caduca.getTime() < inicio + 48 * 60 * 60 * 1000)
      .map(resumenPlan)
    const resumen = {
      dry: true,
      candidatas: candidatas.length,
      conRecuperacionPosible: conRed.length,
      porPrimerPaso: {
        cdn: conRed.filter((p) => p.pasos[0] === 'cdn').length,
        graph: conRed.filter((p) => p.pasos[0] === 'graph').length,
        permalink: conRed.filter((p) => p.pasos[0] === 'permalink').length,
      },
      aAnularSinIntentos: soloAnular.length,
      sinRecuperacion: sinRecuperacion.length,
      urgentesMenosDe48h: urgentes.length,
      tokenMeta: !!token,
    }
    // El modo dry no toca content_pieces ni Storage; solo deja la fila de
    // cron_runs, que es donde se puede leer la respuesta cuando la ruta se
    // invoca desde pg_net.
    await logCronRun('backfill-portadas', {
      ...resumen,
      primerasUrgentes: urgentes.slice(0, 15).map((u) => ({ id: u.id, tipo: u.tipo, caducaCdn: u.caducaCdn })),
    })
    return NextResponse.json({
      ...resumen,
      urgentes,
      orden: conRed.slice(0, limite).map(resumenPlan),
      anular: soloAnular.map(resumenPlan),
      sinRecuperacionDetalle: sinRecuperacion.map((p) => ({ ...resumenPlan(p), motivo: p.motivoSinRecuperacion })),
    })
  }

  const { data: clientes } = await supabase.from('clients').select('id, ig_account_id')
  const cuentaPorCliente = new Map((clientes ?? []).map((c) => [c.id as string, c.ig_account_id as string | null]))
  // /media por cliente, pedido una sola vez y solo si hace falta buscar por permalink.
  const mediosPorCliente = new Map<string, Promise<Map<string, MedioDeCuenta>>>()
  function mediosDe(clientId: string): Promise<Map<string, MedioDeCuenta>> {
    let medios = mediosPorCliente.get(clientId)
    if (!medios) {
      const cuenta = cuentaPorCliente.get(clientId)
      medios = cuenta && token
        ? listarMediosDeCuenta(cuenta, token, MAX_MEDIOS_BUSQUEDA).then(({ medios: lista }) => {
            const porCodigo = new Map<string, MedioDeCuenta>()
            for (const m of lista) {
              const codigo = codigoPermalink(m.permalink)
              if (codigo) porCodigo.set(codigo, m)
            }
            return porCodigo
          })
        : Promise.resolve(new Map())
      mediosPorCliente.set(clientId, medios)
    }
    return medios
  }

  // Escribe solo si ig_thumbnail_url sigue siendo el valor leído.
  async function escribir(pieza: Pieza, valor: string | null): Promise<string | null> {
    let query = supabase.from('content_pieces').update({ ig_thumbnail_url: valor }).eq('id', pieza.id)
    query = pieza.ig_thumbnail_url === null ? query.is('ig_thumbnail_url', null) : query.eq('ig_thumbnail_url', pieza.ig_thumbnail_url)
    const { error } = await query
    return error ? error.message : null
  }

  const guardadas: { id: string; codigo: string | null; paso: Paso }[] = []
  const anuladas: string[] = []
  const fallidas: { id: string; codigo: string | null; tipo: string; errores: string[] }[] = []

  async function procesar(plan: Plan): Promise<void> {
    const { pieza } = plan
    const errores: string[] = []
    for (const paso of plan.pasos) {
      let origen: string | null = null
      let mediaId: string
      if (paso === 'cdn') {
        origen = pieza.ig_thumbnail_url
        mediaId = esMedioReal(pieza.ig_media_id) ? pieza.ig_media_id : idPortadaManual(pieza.id, origen!)
      } else if (paso === 'graph') {
        if (!token) { errores.push('graph: falta META_SYSTEM_USER_TOKEN'); continue }
        const r = await portadaPorGraph(pieza.ig_media_id!, token)
        if (!r.url) { errores.push(`graph: ${r.error}`); continue }
        origen = r.url
        mediaId = pieza.ig_media_id!
      } else {
        const medio = (await mediosDe(pieza.client_id)).get(codigoPermalink(pieza.ig_permalink)!)
        if (!medio) { errores.push('permalink: no aparece en /media'); continue }
        origen = elegirPortada(medio)
        if (!origen) { errores.push('permalink: el medio no trae imagen'); continue }
        mediaId = medio.id
      }
      const guardada = await guardarPortada(supabase, pieza.client_id, mediaId, origen)
      if (!guardada) { errores.push(`${paso}: no se pudo descargar o subir`); continue }
      const errorEscritura = await escribir(pieza, guardada)
      if (errorEscritura) { errores.push(`${paso}: ${errorEscritura}`); break }
      guardadas.push({ id: pieza.id, codigo: pieza.keyword_trigger, paso })
      return
    }
    if (plan.urlMuerta) {
      const errorEscritura = await escribir(pieza, null)
      if (!errorEscritura) { anuladas.push(pieza.id); return }
      errores.push(`anular: ${errorEscritura}`)
    }
    fallidas.push({ id: pieza.id, codigo: pieza.keyword_trigger, tipo: pieza.content_type, errores })
  }

  // Anular no toca la red: se hace completo en cada corrida.
  for (const plan of soloAnular) {
    const errorEscritura = await escribir(plan.pieza, null)
    if (errorEscritura) fallidas.push({ id: plan.pieza.id, codigo: plan.pieza.keyword_trigger, tipo: plan.pieza.content_type, errores: [`anular: ${errorEscritura}`] })
    else anuladas.push(plan.pieza.id)
  }

  const lote = conRed.slice(0, limite)
  let procesadas = 0
  let cortadoPorTiempo = false
  for (let i = 0; i < lote.length; i += CONCURRENCIA) {
    if (Date.now() - inicio > PRESUPUESTO_MS) {
      cortadoPorTiempo = true
      break
    }
    const tanda = lote.slice(i, i + CONCURRENCIA)
    await Promise.all(tanda.map(procesar))
    procesadas += tanda.length
  }

  // Las que no se alcanzaron a intentar en esta corrida. Las que fallaron sí
  // se intentaron: no cuentan, para que invocar de nuevo siempre avance.
  const quedan = conRed.length - procesadas
  const resumen = {
    dry: false,
    limite,
    candidatas: candidatas.length,
    procesadas,
    guardadas: guardadas.length,
    anuladas: anuladas.length,
    fallidas: fallidas.length,
    sinRecuperacion: sinRecuperacion.length,
    quedan,
    cortadoPorTiempo,
    segundos: Math.round((Date.now() - inicio) / 1000),
  }
  await logCronRun('backfill-portadas', { ...resumen, detalleFallidas: fallidas.slice(0, 20) })

  return NextResponse.json({
    ...resumen,
    siguiente: quedan > 0 ? 'vuelve a invocar la ruta para seguir' : 'no quedan piezas por intentar',
    guardadasDetalle: guardadas,
    anuladasDetalle: anuladas,
    fallidasDetalle: fallidas,
  })
}
