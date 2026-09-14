import { createAdminClient } from '@/lib/supabase/admin'

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
 * un upsert con la sesión del usuario falla sin avisar.
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
 * Descarga la portada y la guarda en Storage. Devuelve la URL pública, o null
 * si no se pudo (URL caducada, no es imagen, Storage caído). Nunca lanza.
 */
export async function guardarPortada(
  supabase: Supabase,
  clientId: string,
  mediaId: string,
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
    const ruta = `content/${clientId}/${mediaId}.${ext}`
    const { error } = await supabase.storage
      .from('thumbnails')
      .upload(ruta, await res.arrayBuffer(), { contentType: tipo, upsert: true })
    if (error) {
      console.error(`[portadas] no se pudo subir ${mediaId}: ${error.message}`)
      return null
    }
    return supabase.storage.from('thumbnails').getPublicUrl(ruta).data.publicUrl
  } catch (err) {
    console.error(`[portadas] no se pudo descargar ${mediaId}: ${err instanceof Error ? err.message : err}`)
    return null
  }
}
