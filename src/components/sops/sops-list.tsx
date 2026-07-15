'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs } from '@/components/ui/tabs'
import { SopForm } from './sop-form'
import { OnboardingTemplateForm } from './onboarding-template-form'
import { deleteSopAction, deleteCategoryAction } from '@/lib/actions/sops'
import { formatDate, cn } from '@/lib/utils'
import { SOP_TAGS } from '@/lib/types'
import type { Sop, OnboardingTemplate } from '@/lib/types'
import { Plus, Trash2, FileText, ChevronDown } from 'lucide-react'

interface Props {
  sops: Sop[]
  templates: OnboardingTemplate[]
}

// Deterministic color per tag — works for the predefined SOP_TAGS and any
// custom category a user adds, no maintenance needed as new ones show up.
const TAG_PALETTE = [
  { text: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/25', solid: 'bg-violet-400' },
  { text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/25', solid: 'bg-blue-400' },
  { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/25', solid: 'bg-emerald-400' },
  { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/25', solid: 'bg-amber-400' },
  { text: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/25', solid: 'bg-rose-400' },
  { text: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/25', solid: 'bg-cyan-400' },
  { text: 'text-fuchsia-400', bg: 'bg-fuchsia-500/10', border: 'border-fuchsia-500/25', solid: 'bg-fuchsia-400' },
  { text: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/25', solid: 'bg-orange-400' },
]

function tagColor(tag: string) {
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0
  return TAG_PALETTE[hash % TAG_PALETTE.length]
}


export function SopsList({ sops, templates }: Props) {
  const [showSopForm, setShowSopForm] = useState(false)
  const [showTemplateForm, setShowTemplateForm] = useState(false)
  const [editingSop, setEditingSop] = useState<Sop | null>(null)

  const [activeTag, setActiveTag] = useState<string>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    if (!filterOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [filterOpen])

  const tabs = [
    { id: 'sops', label: 'SOPs', count: sops.length },
    { id: 'templates', label: 'Templates de Onboarding', count: templates.length },
  ]

  // Predefined tag filter (BIZ areas) + keep any legacy/custom categories present in data
  const legacyCategories = ([...new Set(sops.map((s) => s.category).filter(Boolean))] as string[])
    .filter((c) => !(SOP_TAGS as readonly string[]).includes(c))
  const allCategories = [...SOP_TAGS, ...legacyCategories]
  const filterTags = ['all', ...allCategories]

  const visibleSops = activeTag === 'all' ? sops : sops.filter((s) => s.category === activeTag)
  const categories = [...new Set(visibleSops.map((s) => s.category).filter((c): c is string => !!c))]

  async function handleDeleteCategory(e: React.MouseEvent, cat: string) {
    e.stopPropagation()
    const count = sops.filter((s) => s.category === cat).length
    const msg = count > 0
      ? `¿Eliminar la categoría "${cat}"? Se le va a quitar la categoría a ${count} SOP${count !== 1 ? 's' : ''} (no se borran los SOPs).`
      : `¿Eliminar la categoría "${cat}"?`
    if (!confirm(msg)) return
    await deleteCategoryAction(cat)
    if (activeTag === cat) setActiveTag('all')
    router.refresh()
  }


  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">SOPs y Onboarding</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Procedimientos operativos y flujos de incorporación
          </p>
        </div>
      </div>

      <Tabs tabs={tabs}>
        {(activeTab) => (
          <>
            {activeTab === 'sops' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div ref={filterRef} className="relative">
                    <button
                      onClick={() => setFilterOpen((v) => !v)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                        activeTag === 'all'
                          ? 'border-zinc-700 text-zinc-300 hover:border-zinc-600'
                          : `${tagColor(activeTag).border} ${tagColor(activeTag).bg} ${tagColor(activeTag).text}`
                      )}
                    >
                      {activeTag !== 'all' && <span className={`h-1.5 w-1.5 rounded-full ${tagColor(activeTag).solid}`} />}
                      {activeTag === 'all' ? 'Todos' : activeTag}
                      <ChevronDown className={cn('h-3 w-3 transition-transform', filterOpen && 'rotate-180')} />
                    </button>

                    {filterOpen && (
                      <div className="absolute top-full left-0 mt-1.5 flex flex-wrap gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 p-2 shadow-xl z-10 w-max max-w-sm">
                        {filterTags.map((tag) => {
                          const c = tag === 'all' ? null : tagColor(tag)
                          return (
                            <div
                              key={tag}
                              role="button"
                              tabIndex={0}
                              onClick={() => { setActiveTag(tag); setFilterOpen(false) }}
                              onKeyDown={(e) => { if (e.key === 'Enter') { setActiveTag(tag); setFilterOpen(false) } }}
                              className={cn(
                                'flex items-center gap-1.5 rounded-full border pl-3 pr-1.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                                activeTag === tag
                                  ? c
                                    ? `${c.border} ${c.bg} ${c.text}`
                                    : 'border-zinc-50 bg-zinc-50 text-zinc-950'
                                  : 'border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                              )}
                            >
                              {c && <span className={`h-1.5 w-1.5 rounded-full ${c.solid}`} />}
                              {tag === 'all' ? 'Todos' : tag}
                              {tag !== 'all' && (
                                <button
                                  type="button"
                                  onClick={(e) => handleDeleteCategory(e, tag)}
                                  title={`Eliminar categoría "${tag}"`}
                                  className="ml-0.5 rounded-full p-0.5 text-current opacity-50 hover:opacity-100 hover:bg-black/20 transition-opacity"
                                >
                                  <Trash2 className="h-2.5 w-2.5" />
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  <Button size="sm" onClick={() => setShowSopForm(true)}>
                    <Plus className="h-3.5 w-3.5" /> Nuevo SOP
                  </Button>
                </div>
                {visibleSops.length === 0 ? (

                  <Card><div className="text-center text-zinc-500 py-8">No hay SOPs creados</div></Card>
                ) : (
                  <div className="space-y-6">
                    {categories.length > 0 ? (
                      categories.map((cat) => (
                        <div key={cat}>
                          <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider mb-3">
                            <span className={`h-1.5 w-1.5 rounded-full ${tagColor(cat).solid}`} />
                            <span className={tagColor(cat).text}>{cat}</span>
                          </h3>
                          <div className="space-y-2">
                            {visibleSops.filter((s) => s.category === cat).map((sop) => (

                              <Card key={sop.id} className="p-4 flex items-center justify-between cursor-pointer hover:border-zinc-700" onClick={() => setEditingSop(sop)}>
                                <div className="flex items-center gap-3">
                                  <FileText className="h-4 w-4 text-zinc-400" />
                                  <div>
                                    <p className="font-medium text-zinc-100">{sop.title}</p>
                                    <p className="text-xs text-zinc-500">v{sop.version} · {formatDate(sop.updated_at)}</p>
                                  </div>
                                </div>
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation()
                                    if (confirm('¿Eliminar este SOP?')) {
                                      await deleteSopAction(sop.id)
                                      router.refresh()
                                    }
                                  }}
                                  className="text-zinc-500 hover:text-red-400"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </Card>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="space-y-2">
                        {sops.map((sop) => (
                          <Card key={sop.id} className="p-4 flex items-center justify-between cursor-pointer hover:border-zinc-700" onClick={() => setEditingSop(sop)}>
                            <div className="flex items-center gap-3">
                              <FileText className="h-4 w-4 text-zinc-400" />
                              <div>
                                <p className="font-medium text-zinc-100">{sop.title}</p>
                                <p className="text-xs text-zinc-500">v{sop.version} · {formatDate(sop.updated_at)}</p>
                              </div>
                            </div>
                            <button
                              onClick={async (e) => {
                                e.stopPropagation()
                                if (confirm('¿Eliminar este SOP?')) {
                                  await deleteSopAction(sop.id)
                                  router.refresh()
                                }
                              }}
                              className="text-zinc-500 hover:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'templates' && (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => setShowTemplateForm(true)}>
                    <Plus className="h-3.5 w-3.5" /> Nuevo Template
                  </Button>
                </div>
                {templates.length === 0 ? (
                  <Card><div className="text-center text-zinc-500 py-8">No hay templates de onboarding</div></Card>
                ) : (
                  <div className="space-y-2">
                    {templates.map((t) => (
                      <Card key={t.id} className="p-4">
                        <p className="font-medium text-zinc-100">{t.name}</p>
                        <p className="text-xs text-zinc-500 mt-1">
                          {t.steps?.length || 0} paso{(t.steps?.length || 0) !== 1 ? 's' : ''}
                        </p>
                        <div className="mt-2 space-y-1">
                          {(t.steps || []).map((step, i) => (
                            <p key={i} className="text-xs text-zinc-400">
                              {i + 1}. {step.title}
                            </p>
                          ))}
                        </div>

                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Tabs>

      {showSopForm && <SopForm existingCategories={allCategories} onClose={() => { setShowSopForm(false); router.refresh() }} />}
      {editingSop && <SopForm sop={editingSop} existingCategories={allCategories} onClose={() => { setEditingSop(null); router.refresh() }} />}
      {showTemplateForm && <OnboardingTemplateForm sops={sops} onClose={() => { setShowTemplateForm(false); router.refresh() }} />}
    </>
  )
}
