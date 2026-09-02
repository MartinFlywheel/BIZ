'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createContentAction, updateContentAction } from '@/lib/actions/content'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ContentPiece } from '@/lib/types'

interface Props {
    clientId: string
    editingPiece?: ContentPiece | null
    onClose: () => void
    onCreated?: () => void
}

export function ContentPieceForm({ clientId, editingPiece, onClose, onCreated }: Props) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const router = useRouter()
    const isEditing = !!editingPiece

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        setLoading(true)
        setError(null)
        const formData = new FormData(e.currentTarget)
        formData.set('client_id', clientId)
        const result = isEditing
            ? await updateContentAction(editingPiece.id, clientId, formData).catch(e => ({
                success: false as const,
                error: e instanceof Error ? e.message : 'Error inesperado',
            }))
            : await createContentAction(formData).catch(e => ({
                success: false as const,
                error: e instanceof Error ? e.message : 'Error inesperado',
            }))
        setLoading(false)
        if (!result.success) {
            setError(result.error)
            return
        }
        router.refresh()
        onCreated?.()
        onClose()
    }

    return (
        <Dialog
            open
            onClose={onClose}
            title={isEditing ? 'Editar Pieza de Contenido' : 'Nueva Pieza de Contenido'}
            description={isEditing ? 'Corregí los datos de la pieza (código, link, portada, tipo, fecha)' : 'Registra una pieza para luego cargarle sus métricas de funnel'}
        >
            <form onSubmit={handleSubmit} className="space-y-4">
                {/* Caption */}
                <Input
                    id="caption"
                    name="caption"
                    label="Nombre base o referencia"
                    defaultValue={editingPiece?.caption ?? undefined}
                    placeholder="Ej: Reel de oferta junio — cierre de mes"
                />

                {/* Keyword trigger */}
                <div className="space-y-1.5">
                    <Input
                        id="keyword_trigger"
                        name="keyword_trigger"
                        label="ID de pieza / origen payload"
                        defaultValue={editingPiece?.keyword_trigger ?? undefined}
                        placeholder="Ej: C_21_04 o NEW_FOLLOW"
                    />
                    <p className="text-[11px] text-zinc-600 leading-snug">
                        Ej: <span className="font-mono text-zinc-500">C_21_04</span> o{' '}
                        <span className="font-mono text-zinc-500">NEW_FOLLOW</span> para ManyChat/n8n
                    </p>
                </div>

                {/* Content type */}
                <div className="space-y-1.5">
                    <label htmlFor="content_type" className="block text-sm font-medium text-zinc-400">
                        Tipo de contenido
                    </label>
                    <select
                        id="content_type"
                        name="content_type"
                        required
                        defaultValue={editingPiece?.content_type ?? 'reel'}
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
                    >
                        <option value="reel">Reel</option>
                        <option value="trial">Trial</option>
                        <option value="story">Story</option>
                        <option value="post">Post</option>
                        <option value="live">Live</option>
                    </select>
                </div>

                {/* Hook */}
                <div className="space-y-1.5">
                    <label htmlFor="hook" className="block text-sm font-medium text-zinc-400">
                        Hook usado
                    </label>
                    <textarea
                        id="hook"
                        name="hook"
                        rows={2}
                        defaultValue={editingPiece?.hook ?? undefined}
                        placeholder="La línea de apertura que engancha en los primeros segundos..."
                        className="flex w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 resize-none"
                    />
                </div>

                {/* IG permalink */}
                <Input
                    id="ig_permalink"
                    name="ig_permalink"
                    label="Link de IG"
                    type="url"
                    defaultValue={editingPiece?.ig_permalink ?? undefined}
                    placeholder="https://www.instagram.com/reel/..."
                />

                {/* Thumbnail manual */}
                <div className="space-y-1.5">
                    <Input
                        id="ig_thumbnail_url"
                        name="ig_thumbnail_url"
                        label="Portada / Thumbnail (URL)"
                        type="url"
                        defaultValue={editingPiece?.ig_thumbnail_url ?? undefined}
                        placeholder="https://... o pegar link de imagen"
                    />
                    <p className="text-[11px] text-zinc-600 leading-snug">
                        Tip: abre el Reel en el navegador, click derecho en la imagen → &quot;Copiar dirección de imagen&quot;
                    </p>
                </div>

                {/* Published at */}
                <div className="space-y-1.5">
                    <label htmlFor="published_at" className="block text-sm font-medium text-zinc-400">
                        Fecha de publicación
                    </label>
                    <input
                        id="published_at"
                        name="published_at"
                        type="date"
                        defaultValue={editingPiece?.published_at ? editingPiece.published_at.slice(0, 10) : undefined}
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 [color-scheme:dark]"
                    />
                </div>

                {error && (
                    <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">
                        {error}
                    </p>
                )}

                <div className="flex gap-3 pt-1">
                    <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
                        Cancelar
                    </Button>
                    <Button type="submit" disabled={loading} className="flex-1">
                        {loading ? 'Guardando...' : isEditing ? 'Guardar Cambios' : 'Crear Pieza'}
                    </Button>
                </div>
            </form>
        </Dialog>
    )
}
