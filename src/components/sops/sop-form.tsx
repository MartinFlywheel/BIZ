'use client'

import { useState } from 'react'
import { createSopAction, updateSopAction } from '@/lib/actions/sops'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { SOP_TAGS } from '@/lib/types'
import type { Sop, SopAttachment } from '@/lib/types'
import { X, Link2, FileText, Video, Layout, Play, ExternalLink, Plus } from 'lucide-react'

// ── Attachment detection ──────────────────────────────────────────────────────

function detectType(url: string): SopAttachment['type'] {
  if (/loom\.com/i.test(url)) return 'loom'
  if (/docs\.google\.com\/document/i.test(url)) return 'google_doc'
  if (/drive\.google\.com|docs\.google\.com\/drive/i.test(url)) return 'google_drive'
  if (/miro\.com/i.test(url)) return 'miro'
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube'
  if (/notion\.so/i.test(url)) return 'notion'
  return 'link'
}

function getEmbedUrl(url: string, type: SopAttachment['type']): string | undefined {
  switch (type) {
    case 'loom': {
      const id = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/)?.[1]
      return id ? `https://www.loom.com/embed/${id}?hide_owner=true&hide_share=true&hideEmbedTopBar=true` : undefined
    }
    case 'google_doc': {
      const id = url.match(/docs\.google\.com\/document\/d\/([^/?]+)/)?.[1]
      return id ? `https://docs.google.com/document/d/${id}/preview` : undefined
    }
    case 'google_drive': {
      const id = url.match(/drive\.google\.com\/file\/d\/([^/?]+)/)?.[1]
      return id ? `https://drive.google.com/file/d/${id}/preview` : undefined
    }
    case 'miro': {
      const id = url.match(/miro\.com\/app\/board\/([^/?]+)/)?.[1]
      return id ? `https://miro.com/app/live-embed/${id}/` : undefined
    }
    case 'youtube': {
      const id = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&/?]+)/)?.[1]
      return id ? `https://www.youtube.com/embed/${id}` : undefined
    }
    default:
      return undefined
  }
}

function autoTitle(url: string, type: SopAttachment['type']): string {
  const labels: Record<SopAttachment['type'], string> = {
    loom: 'Video Loom',
    google_doc: 'Documento Google',
    google_drive: 'Archivo en Drive',
    miro: 'Tablero Miro',
    youtube: 'Video YouTube',
    notion: 'Página Notion',
    link: (() => { try { return new URL(url).hostname.replace('www.', '') } catch { return 'Enlace' } })(),
  }
  return labels[type]
}

// ── Type icon + colors ────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<SopAttachment['type'], { label: string; icon: React.ElementType; color: string }> = {
  loom:         { label: 'Loom',        icon: Video,      color: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
  google_doc:   { label: 'Google Doc',  icon: FileText,   color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
  google_drive: { label: 'Drive',       icon: FileText,   color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' },
  miro:         { label: 'Miro',        icon: Layout,     color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' },
  youtube:      { label: 'YouTube',     icon: Play,       color: 'text-red-400 bg-red-500/10 border-red-500/20' },
  notion:       { label: 'Notion',      icon: FileText,   color: 'text-zinc-300 bg-zinc-500/10 border-zinc-500/20' },
  link:         { label: 'Enlace',      icon: Link2,      color: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20' },
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  sop?: Sop
  onClose: () => void
}

const CUSTOM_CATEGORY = '__custom__'

export function SopForm({ sop, onClose }: Props) {
  const [loading, setLoading]       = useState(false)
  const [urlInput, setUrlInput]     = useState('')
  const [attachments, setAttachments] = useState<SopAttachment[]>(sop?.attachments ?? [])
  const [expandedEmbed, setExpandedEmbed] = useState<string | null>(null)

  const initialIsCustom = !!sop?.category && !(SOP_TAGS as readonly string[]).includes(sop.category)
  const [categorySelect, setCategorySelect] = useState(sop?.category || '')
  const [customCategory, setCustomCategory] = useState('')

  function addAttachment() {
    const raw = urlInput.trim()
    if (!raw) return
    let url = raw
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url

    const type = detectType(url)
    const embed_url = getEmbedUrl(url, type)
    const newItem: SopAttachment = {
      id: crypto.randomUUID(),
      type,
      url,
      title: autoTitle(url, type),
      embed_url,
    }
    setAttachments((prev) => [...prev, newItem])
    setUrlInput('')
    if (embed_url) setExpandedEmbed(newItem.id)
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
    if (expandedEmbed === id) setExpandedEmbed(null)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const formData = new FormData(e.currentTarget)
    formData.set('attachments', JSON.stringify(attachments))
    if (categorySelect === CUSTOM_CATEGORY) {
      formData.set('category', customCategory.trim())
    }
    if (sop) {
      await updateSopAction(sop.id, formData)
    } else {
      await createSopAction(formData)
    }
    setLoading(false)
    onClose()
  }

  return (
    <Modal onClose={onClose} size="lg">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-zinc-50">
          {sop ? 'Editar SOP' : 'Nuevo SOP'}
        </h2>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <Input
          id="title"
          name="title"
          label="Título"
          placeholder="Script de Llamada de Cierre"
          defaultValue={sop?.title}
          required
        />

        <div className="space-y-1.5">
          <label htmlFor="category" className="block text-sm font-medium text-zinc-400">Categoría</label>
          <select
            id="category"
            name="category"
            value={categorySelect}
            onChange={(e) => setCategorySelect(e.target.value)}
            className="flex h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 [&>option]:bg-zinc-900"
          >
            <option value="">Sin categoría</option>
            {SOP_TAGS.map((tag) => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
            {initialIsCustom && <option value={sop!.category!}>{sop!.category}</option>}
            <option value={CUSTOM_CATEGORY}>+ Nueva categoría...</option>
          </select>
          {categorySelect === CUSTOM_CATEGORY && (
            <input
              autoFocus
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
              placeholder="Nombre de la nueva categoría"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500"
            />
          )}
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-zinc-400">Contenido (Markdown)</label>
          <textarea
            name="content"
            defaultValue={sop?.content || ''}
            rows={8}
            placeholder={"# Título del SOP\n\n## Paso 1\nDescripción del paso...\n\n## Paso 2\n..."}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 resize-y font-mono"
          />
        </div>

        {/* ── Recursos y adjuntos ── */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-zinc-400">Recursos y adjuntos</label>

          {/* URL input */}
          <div className="flex gap-2">
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAttachment() } }}
              placeholder="Pegar URL — Loom, Google Docs, Drive, Miro, YouTube..."
              className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500"
            />
            <button
              type="button"
              onClick={addAttachment}
              disabled={!urlInput.trim()}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Agregar
            </button>
          </div>

          {/* Attachment list */}
          {attachments.length > 0 && (
            <div className="space-y-2">
              {attachments.map((a) => {
                const cfg = TYPE_CONFIG[a.type]
                const Icon = cfg.icon
                const isExpanded = expandedEmbed === a.id

                return (
                  <div key={a.id} className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
                    {/* Header row */}
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold shrink-0 ${cfg.color}`}>
                        <Icon className="h-3 w-3" />
                        {cfg.label}
                      </span>
                      <span className="flex-1 text-sm text-zinc-300 truncate">{a.title}</span>
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      {a.embed_url && (
                        <button
                          type="button"
                          onClick={() => setExpandedEmbed(isExpanded ? null : a.id)}
                          className="text-[11px] text-zinc-600 hover:text-zinc-300 transition-colors shrink-0"
                        >
                          {isExpanded ? 'Ocultar' : 'Vista previa'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeAttachment(a.id)}
                        className="shrink-0 text-zinc-700 hover:text-red-400 transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Embed preview */}
                    {isExpanded && a.embed_url && (
                      <div className="border-t border-zinc-800">
                        <iframe
                          src={a.embed_url}
                          className="w-full"
                          style={{ height: a.type === 'miro' ? '480px' : '420px' }}
                          allow="fullscreen"
                          allowFullScreen
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <input type="hidden" name="attachments" value={JSON.stringify(attachments)} />
        </div>

        <div className="flex gap-3 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button type="submit" disabled={loading} className="flex-1">
            {loading ? 'Guardando...' : sop ? 'Actualizar' : 'Crear'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
