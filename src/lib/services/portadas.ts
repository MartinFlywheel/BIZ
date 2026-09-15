import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * Portadas permanentes para el contenido de Instagram.
 *
 * Meta entrega las imágenes como URLs firmadas de su CDN que caducan en pocos
 * días (el parámetro `oe`). Guardar solo esa URL dejaba las tarjetas con la
 * imagen rota a la semana, y en las historias no hay segunda oportunidad: una
 * vez vencidas, la API ya no las devuelve. Por eso la portada se descarga y se
 * sube al bucket público `thumbnails` la primera vez que se ve.
 *
 * Siempre con el cliente admin: el bucket no tiene política de UPDATE, así que
 * un upsert con la sesión del usuario falla sin avisar. Las server actions
 * crean uno con createAdminClient() solo para la subida, después de que la
 * escritura con la sesión del usuario ya pasó la RLS.
 *
 * Este módulo no importa nada de servidor en tiempo de ejecución (solo el tipo
 * del cliente admin), así que las funciones puras de URL también las puede
 * usar la interfaz.
 */

type Supabase = ReturnType<typeof createAdminClient>

const MARCA_STORAGE = '/storage/v1/object/public/thumbnails/'

/** La URL ya apunta a una portada guardada en Storage. */
export function esPortadaGuardada(url: string | null | undefined): boolean {
  return !!url && url.includes(MARCA_STORAGE)
}

/** Un .mp4 no sirve como portada: un <img> no lo puede mostrar. */
export function esVideo(url: string | null | undefined): boolean {
  return !!url && /\.mp4(\?|$)/i.test(url)
}

/** URL del CDN de Meta: viene firmada y caduca. */
export function esCdnMeta(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const host = new URL(url).hostname
    return host.endsWith('cdninstagram.com') || host.endsWith('fbcdn.net')
  } catch {
    return false
  }
}

/**
 * Cuándo deja de responder una URL firmada de Meta. El parámetro `oe` es un
 * epoch en segundos escrito en hexadecimal. Null si la URL no lo trae.
 */
export function caducidadCdn(url: string | null | undefined): Date | null {
  if (!url) return null
  const oe = /[?&]oe=([0-9a-f]+)/i.exec(url)?.[1]
  if (!oe) return null
  const segundos = parseInt(oe, 16)
  return Number.isFinite(segundos) ? new Date(segundos * 1000) : null
}

/**
 * El código corto de un permalink de reel o post (instagram.com/reel/XYZ/).
 * Los enlaces copiados desde la app traen ?utm_source=..., así que comparar
 * el string completo nunca encontraba la pieza sincronizada.
 */
export function codigoPermalink(url: string | null | undefined): string | null {
  if (!url) return null
  return /instagram\.com\/(?:[^/]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/i.exec(url)?.[1] ?? null
}

interface MedioIg {
  media_type?: string
  media_url?: string | null
  thumbnail_url?: string | null
}

/**
 * La imagen que corresponde como portada: en videos, thumbnail_url (Meta omite
 * media_url cuando el video tiene música con derechos); en imágenes y
 * carruseles, media_url. Nunca un mp4.
 */
export function elegirPortada(medio: MedioIg): string | null {
  const candidatas = medio.media_type === 'VIDEO' || medio.media_type === 'REELS'
    ? [medio.thumbnail_url, medio.media_url]
    : [medio.media_url, medio.thumbnail_url]
  return candidatas.find((u): u is string => !!u && !esVideo(u)) ?? null
}

/**
 * Descarga una imagen y la sube a `thumbnails/<ruta>.<ext>`. Devuelve la URL
 * pública, o null si no se pudo (URL caducada, no es imagen, Storage caído).
 * Nunca lanza.
 */
export async function guardarImagen(
  supabase: Supabase,
  rutaSinExtension: string,
  urlOrigen: string | null | undefined
): Promise<string | null> {
  if (!urlOrigen || esVideo(urlOrigen)) return null
  if (esPortadaGuardada(urlOrigen)) return urlOrigen
  try {
    const res = await fetch(urlOrigen, { redirect: 'follow', signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const tipo = res.headers.get('content-type') ?? ''
    if (!tipo.startsWith('image/')) return null
    const ext = tipo.includes('png') ? 'png' : tipo.includes('webp') ? 'webp' : 'jpg'
    const ruta = `${rutaSinExtension}.${ext}`
    const { error } = await supabase.storage
      .from('thumbnails')
      .upload(ruta, await res.arrayBuffer(), { contentType: tipo, upsert: true })
    if (error) {
      console.error(`[portadas] no se pudo subir ${ruta}: ${error.message}`)
      return null
    }
    return supabase.storage.from('thumbnails').getPublicUrl(ruta).data.publicUrl
  } catch (err) {
    console.error(`[portadas] no se pudo descargar ${rutaSinExtension}: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

/**
 * Portada de una pieza de contenido, en `content/<cliente>/<mediaId>`. Para
 * un mismo medio de Instagram la imagen no cambia, así que la ruta fija hace
 * que subirla dos veces no duplique nada.
 */
export async function guardarPortada(
  supabase: Supabase,
  clientId: string,
  mediaId: string,
  urlOrigen: string | null | undefined
): Promise<string | null> {
  return guardarImagen(supabase, `content/${clientId}/${mediaId}`, urlOrigen)
}

/**
 * Nombre de archivo para una portada pegada a mano en una pieza sin medio de
 * Instagram. Lleva un hash de la URL de origen: si alguien cambia la portada,
 * la ruta cambia también y el navegador no sigue mostrando la anterior desde
 * su caché (Storage la sirve con cache-control de una hora).
 */
export function idPortadaManual(pieceId: string, urlOrigen: string): string {
  // FNV-1a de 32 bits: basta para distinguir URLs y funciona igual en el
  // navegador, sin depender de node:crypto.
  let hash = 0x811c9dc5
  for (let i = 0; i < urlOrigen.length; i++) {
    hash ^= urlOrigen.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `pieza-${pieceId}-${(hash >>> 0).toString(16)}`
}

/**
 * Cuántas subidas quedan en esta corrida. Cada descarga más subida toma entre
 * 0,3 y 1 s; sin tope, una corrida con muchas piezas sin portada se pasaría
 * del límite de 60 s de Vercel. La corrida siguiente continúa donde quedó.
 */
export interface CupoPortadas {
  restantes: number
}

export const SUBIDAS_POR_CORRIDA = 20

export function crearCupo(maximo = SUBIDAS_POR_CORRIDA): CupoPortadas {
  return { restantes: maximo }
}

export type ResultadoPortada = 'guardada' | 'fallida' | 'sin-cupo' | null

/**
 * Qué escribir en ig_thumbnail_url para una pieza que llega de la API de Meta.
 * `valor` undefined significa "no tocar la columna".
 *
 * - Una portada ya guardada en Storage nunca se pisa.
 * - Una URL pegada a mano que no es del CDN de Meta (y no es un mp4) tampoco:
 *   es la elección del equipo y no caduca.
 * - Si hay cupo, se guarda en Storage; si no hay cupo o la subida falla, se
 *   escribe la URL fresca del CDN, que al menos carga unos días más, y la
 *   corrida siguiente lo vuelve a intentar.
 * - Nunca se escribe NULL encima de algo, salvo que lo actual sea un mp4.
 *
 * El cupo se descuenta antes del primer await, así que es seguro usarlo desde
 * varias promesas en paralelo.
 */
export async function portadaParaEscribir(opciones: {
  supabase: Supabase
  clientId: string
  mediaId: string
  actual: string | null | undefined
  medio: MedioIg
  cupo: CupoPortadas
}): Promise<{ valor: string | null | undefined; resultado: ResultadoPortada }> {
  const { supabase, clientId, mediaId, actual, medio, cupo } = opciones
  if (esPortadaGuardada(actual)) return { valor: undefined, resultado: null }
  if (actual && !esVideo(actual) && !esCdnMeta(actual)) return { valor: undefined, resultado: null }

  const origen = elegirPortada(medio)
  if (!origen) return { valor: esVideo(actual) ? null : undefined, resultado: null }

  if (cupo.restantes <= 0) {
    return { valor: origen === actual ? undefined : origen, resultado: 'sin-cupo' }
  }
  cupo.restantes--
  const guardada = await guardarPortada(supabase, clientId, mediaId, origen)
  if (guardada) return { valor: guardada, resultado: 'guardada' }
  return { valor: origen === actual ? undefined : origen, resultado: 'fallida' }
}

export interface MedioDeCuenta {
  id: string
  caption?: string | null
  media_type: string
  permalink?: string | null
  thumbnail_url?: string | null
  media_url?: string | null
  timestamp: string
}

export const CAMPOS_MEDIO = 'id,caption,media_type,permalink,thumbnail_url,media_url,timestamp'

/**
 * Lista /media de una cuenta siguiendo la paginación de Meta hasta `maximo`
 * ítems. Con un solo `limit=50` sin paginar, los reels más antiguos nunca
 * volvían a sincronizarse: sus métricas quedaban congeladas y su portada
 * caducaba. Nunca registra la URL de paginación: trae el token.
 */
export async function listarMediosDeCuenta(
  igAccountId: string,
  token: string,
  maximo = 200
): Promise<{ medios: MedioDeCuenta[]; error: string | null }> {
  const medios: MedioDeCuenta[] = []
  let url: string | null =
    `https://graph.facebook.com/${igAccountId}/media?fields=${CAMPOS_MEDIO}&limit=50&access_token=${token}`
  while (url && medios.length < maximo) {
    let res: Response
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    } catch (err) {
      const error = err instanceof Error ? err.message : 'error de red'
      if (medios.length === 0) return { medios, error }
      break
    }
    if (!res.ok) {
      // La primera página es la que decide si la cuenta responde. Si falla
      // una página posterior, se trabaja con lo que ya llegó.
      if (medios.length === 0) return { medios, error: `API ${res.status}: ${(await res.text()).slice(0, 300)}` }
      break
    }
    const data: { data?: MedioDeCuenta[]; paging?: { next?: string } } = await res.json()
    medios.push(...(data.data ?? []))
    url = data.paging?.next ?? null
  }
  return { medios: medios.slice(0, maximo), error: null }
}
