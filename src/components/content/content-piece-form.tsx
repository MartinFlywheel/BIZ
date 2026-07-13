'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createContentAction } from '@/lib/actions/content'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Props {
    clientId: string
    onClose: () => void
}

export function ContentPieceForm({ clientId, onClose }: Props) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const router = useRouter()

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        setLoading(true)
        setError(null)
        const formData = new FormData(e.currentTarget)
        formData.set('client_id', clientId)
        const result = await createContentAction(formData).catch(e => ({
            success: false as const,
            error: e instanceof Error ? e.message : 'Error inesperado',
        }))
        setLoading(false)
        if (!result.success) {
            setError(result.error)
            return
        }
        router.refresh()
        onClose()
    }

    return (
        <Dialog
            open
            onClose={onClose}
            title="Nueva Pieza de Contenido"
            description="Registra una pieza para luego cargarle sus métricas de funnel"
        >
            <form onSubmit={handleSubmit} className="space-y-4">
                {/* Caption */}
                <Input
                    id="caption"
                    name="caption"
                    label="Nombre base o referencia"
                    placeholder="Ej: Reel de oferta junio — cierre de mes"
                />

                {/* Keyword trigger */}
                <div className="space-y-1.5">
                    <Input
                        id="keyword_trigger"
                        name="keyword_trigger"
                        label="ID de pieza / origen payload"
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
                        defaultValue="reel"
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
                    >
                        <option value="reel">Reel</option>
                        <option value="story">Story</option>
                        <option value="post">Post</option>
                        <option value="live">Live</option>
                    </select>
                </div>

                {/* IG permalink */}
                <Input
                    id="ig_permalink"
                    name="ig_permalink"
                    label="Link de IG"
                    type="url"
                    placeholder="https://www.instagram.com/reel/..."
                />

                {/* Thumbnail manual */}
                <div className="space-y-1.5">
                    <Input
                        id="ig_thumbnail_url"
                        name="ig_thumbnail_url"
                        label="Portada / Thumbnail (URL)"
                        type="url"
                        placeholder="https://... o pegar link de imagen"
                    />
                    <p className="text-[11px] text-zinc-600 leading-snug">
                        Tip: abrí el Reel en el navegador, click derecho en la imagen → &quot;Copiar dirección de imagen&quot;
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
                        {loading ? 'Creando...' : 'Crear Pieza'}
                    </Button>
                </div>
            </form>
        </Dialog>
    )
}
