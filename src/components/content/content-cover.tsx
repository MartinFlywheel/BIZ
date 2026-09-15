'use client'

import { useState } from 'react'
import { Clapperboard, CircleDashed, FlaskConical, GalleryHorizontalEnd, ImagePlus, Link2, type LucideIcon } from 'lucide-react'
import type { ContentPiece } from '@/lib/types'
import { codigoPermalink, esPortadaGuardada, esVideo } from '@/lib/services/portadas'

// Portada de una pieza de contenido, con un respaldo que explica por qué no
// hay imagen. Antes cada miniatura era un <img> suelto: una URL del CDN de
// Meta caducada quedaba como imagen rota (sin onError), un .mp4 guardado como
// portada no se veía, y la tarjeta gris con "STORY" no decía si faltaba
// agregarla a mano o si la historia ya había vencido sin guardarse.

const DIA_MS = 24 * 60 * 60 * 1000

export const contentTypeLabel: Record<string, string> = {
    reel: 'Reel',
    story: 'Historia',
    post: 'Carrusel',
    live: 'Bio',
    trial: 'Trial',
}

const iconoPorTipo: Record<string, LucideIcon> = {
    reel: Clapperboard,
    story: CircleDashed,
    post: GalleryHorizontalEnd,
    live: Link2,
    trial: FlaskConical,
}

const fondoPorTipo: Record<string, string> = {
    reel: 'from-rose-500/10',
    story: 'from-amber-500/10',
    post: 'from-sky-500/10',
    live: 'from-emerald-500/10',
    trial: 'from-violet-500/10',
}

export function portadaUsable(url: string | null | undefined): url is string {
    return !!url && !esVideo(url)
}

/** La historia ya no está en Instagram: pasaron sus 24 h. */
export function historiaVencida(piece: ContentPiece, ahora: number): boolean {
    if (piece.content_type !== 'story') return false
    if (piece.story_expires_at) return new Date(piece.story_expires_at).getTime() < ahora
    // Las historias manuales no tienen story_expires_at: se deduce de la fecha.
    return !!piece.published_at && new Date(piece.published_at).getTime() + DIA_MS < ahora
}

// Intl.DateTimeFormat es caro de construir; se reutiliza una sola instancia.
let formatoDiaChile: Intl.DateTimeFormat | null = null

/**
 * El día ('YYYY-MM-DD') al que pertenece una pieza, en hora de Chile.
 *
 * Las piezas manuales guardan solo la fecha que escribió el equipo (queda a
 * las 00:00 UTC), así que se usa tal cual: pasarla a hora de Chile la corría
 * al día anterior. Las sincronizadas traen la hora real de publicación, y una
 * historia subida a las 22:00 en Chile ya es el día siguiente en UTC.
 */
export function diaDePieza(piece: ContentPiece): string | null {
    if (!piece.published_at) return null
    if (!piece.ig_media_id) return piece.published_at.slice(0, 10)
    formatoDiaChile ??= new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Santiago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    })
    const fecha = new Date(piece.published_at)
    return Number.isNaN(fecha.getTime()) ? piece.published_at.slice(0, 10) : formatoDiaChile.format(fecha)
}

/**
 * Portadas que una pieza sin medio de Instagram puede tomar prestadas, solo
 * para mostrarlas (no se fusionan filas):
 * - una historia manual (H_dd_mm), la de las historias sincronizadas del mismo
 *   día en hora de Chile;
 * - un reel o post manual con permalink, la de la pieza sincronizada con el
 *   mismo código corto.
 */
export function crearPortadasPrestadas(pieces: ContentPiece[]): (piece: ContentPiece) => string[] {
    const porDiaHistoria = new Map<string, string[]>()
    const porCodigo = new Map<string, string[]>()
    // Primero las guardadas en Storage: no caducan.
    const ordenadas = [...pieces].sort(
        (a, b) => Number(esPortadaGuardada(b.ig_thumbnail_url)) - Number(esPortadaGuardada(a.ig_thumbnail_url))
    )
    for (const p of ordenadas) {
        if (!p.ig_media_id || !portadaUsable(p.ig_thumbnail_url)) continue
        const url = p.ig_thumbnail_url
        if (p.content_type === 'story') {
            const dia = diaDePieza(p)
            if (dia) porDiaHistoria.set(dia, [...(porDiaHistoria.get(dia) ?? []), url])
        }
        const codigo = codigoPermalink(p.ig_permalink)
        if (codigo) porCodigo.set(codigo, [...(porCodigo.get(codigo) ?? []), url])
    }
    return (piece) => {
        if (piece.ig_media_id) return []
        if (piece.content_type === 'story') {
            const dia = diaDePieza(piece)
            return dia ? porDiaHistoria.get(dia) ?? [] : []
        }
        const codigo = codigoPermalink(piece.ig_permalink)
        return codigo ? porCodigo.get(codigo) ?? [] : []
    }
}

interface Motivo {
    texto: string
    permiteAgregar: boolean
}

function motivoSinPortada(piece: ContentPiece, ahora: number, huboUrl: boolean): Motivo {
    const manual = !piece.ig_media_id
    if (piece.content_type === 'story') {
        if (manual) return { texto: 'Historia manual · sin portada', permiteAgregar: true }
        if (historiaVencida(piece, ahora)) return { texto: 'Historia vencida · sin portada guardada', permiteAgregar: true }
        return { texto: 'Historia en curso · la portada se guarda en la próxima sincronización', permiteAgregar: false }
    }
    if (manual) return { texto: 'Pieza manual · agrega una portada', permiteAgregar: true }
    if (huboUrl) return { texto: 'Portada caducada · se renueva al sincronizar', permiteAgregar: false }
    return { texto: 'Sin portada · se obtiene al sincronizar', permiteAgregar: false }
}

interface Props {
    piece: ContentPiece
    ahora: number
    /** Portadas candidatas en orden; si una falla se prueba la siguiente. Por defecto, la de la pieza. */
    urls?: (string | null | undefined)[]
    variante?: 'tarjeta' | 'mini'
    alt?: string
    /** Texto chico bajo el motivo (código o caption). */
    leyenda?: string | null
    /** Etiqueta del tipo; por defecto la del content_type. */
    etiqueta?: string
    onAgregarPortada?: () => void
}

export function ContentCover({ piece, ahora, urls, variante = 'tarjeta', alt, leyenda, etiqueta, onAgregarPortada }: Props) {
    // URLs que ya fallaron al cargar. Se guardan por URL (no un booleano) para
    // que al cambiar la portada, por ejemplo tras editarla, se vuelva a probar.
    const [fallidas, setFallidas] = useState<ReadonlySet<string>>(() => new Set())

    const candidatas = urls ?? [piece.ig_thumbnail_url]
    const url = candidatas.find((u): u is string => portadaUsable(u) && !fallidas.has(u))

    if (url) {
        const prestada = url !== piece.ig_thumbnail_url
        return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
                key={url}
                src={url}
                alt={alt ?? piece.caption ?? contentTypeLabel[piece.content_type] ?? piece.content_type}
                title={prestada && !piece.ig_media_id ? 'Portada tomada de la publicación sincronizada del mismo día' : undefined}
                loading="lazy"
                className="h-full w-full object-cover"
                onError={() => setFallidas((prev) => new Set(prev).add(url))}
            />
        )
    }

    const Icono = iconoPorTipo[piece.content_type] ?? Clapperboard
    const motivo = motivoSinPortada(piece, ahora, candidatas.some((u) => !!u))
    const tipo = etiqueta ?? contentTypeLabel[piece.content_type] ?? piece.content_type

    if (variante === 'mini') {
        return (
            <div
                className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${fondoPorTipo[piece.content_type] ?? 'from-zinc-500/10'} to-zinc-900`}
                title={motivo.texto}
            >
                <Icono className="h-3 w-3 text-zinc-500" />
            </div>
        )
    }

    const agregar = motivo.permiteAgregar ? onAgregarPortada : undefined

    return (
        <div
            className={`flex h-full w-full flex-col items-center justify-center gap-1.5 px-3 pb-6 text-center bg-gradient-to-br ${fondoPorTipo[piece.content_type] ?? 'from-zinc-500/10'} via-zinc-900 to-zinc-950`}
        >
            <Icono className="h-7 w-7 text-zinc-500" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{tipo}</span>
            <span className="text-[11px] leading-snug text-zinc-400">{motivo.texto}</span>
            {leyenda && <span className="line-clamp-2 font-mono text-[10px] leading-tight text-zinc-600">{leyenda}</span>}
            {agregar && (
                // Va dentro del botón que abre la pieza, así que no puede ser
                // otro <button>: es un span con rol de botón que no deja subir
                // el clic.
                <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); agregar() }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            e.stopPropagation()
                            agregar()
                        }
                    }}
                    className="mt-0.5 inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[10px] text-zinc-300 hover:bg-white/[0.08] hover:text-zinc-100 transition-colors"
                >
                    <ImagePlus className="h-3 w-3" />
                    Agregar portada
                </span>
            )}
        </div>
    )
}
