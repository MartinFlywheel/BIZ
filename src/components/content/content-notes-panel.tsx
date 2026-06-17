'use client'

import { useState, useEffect } from 'react'
import { getContentNotes, createNoteAction, deleteNoteAction } from '@/lib/actions/notes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { X, Trash2, MessageSquare } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'

interface Props {
  contentId: string
  contentCaption: string | null
  onClose: () => void
}

export function ContentNotesPanel({ contentId, contentCaption, onClose }: Props) {
  const [notes, setNotes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  async function loadNotes() {
    setLoading(true)
    const data = await getContentNotes(contentId)
    setNotes(data)
    setLoading(false)
  }

  useEffect(() => { loadNotes() }, [contentId])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    formData.set('content_id', contentId)
    await createNoteAction(formData)
    e.currentTarget.reset()
    loadNotes()
  }

  async function handleDelete(noteId: string) {
    await deleteNoteAction(noteId)
    loadNotes()
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
      <div className="w-full max-w-md border-l border-zinc-800 bg-zinc-950 flex flex-col">
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-50 flex items-center gap-2">
              <MessageSquare className="h-4 w-4" /> Notas
            </h2>
            {contentCaption && (
              <p className="text-xs text-zinc-500 mt-1 truncate max-w-[300px]">{contentCaption}</p>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading ? (
            <p className="text-sm text-zinc-500">Cargando...</p>
          ) : notes.length === 0 ? (
            <p className="text-sm text-zinc-500">Sin notas todavía. Agrega la primera.</p>
          ) : (
            notes.map((note) => (
              <div key={note.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-zinc-200 leading-relaxed">{note.note}</p>
                    {note.tags?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {note.tags.map((tag: string) => (
                          <Badge key={tag} variant="info">{tag}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => handleDelete(note.id)} className="text-zinc-500 hover:text-red-400 shrink-0 ml-2">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
                  <span>{note.users?.full_name || 'Anónimo'}</span>
                  <span>·</span>
                  <span>{formatRelativeTime(note.created_at)}</span>
                </div>
              </div>
            ))
          )}
        </div>

        <form onSubmit={handleSubmit} className="border-t border-zinc-800 p-4 space-y-3">
          <textarea
            name="note"
            placeholder="Este CTA funcionó porque..."
            required
            rows={3}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 resize-none"
          />
          <Input
            name="tags"
            placeholder="Tags separados por coma: cta_efectivo, hook_fuerte"
          />
          <Button type="submit" className="w-full" size="sm">Agregar Nota</Button>
        </form>
      </div>
    </div>
  )
}
