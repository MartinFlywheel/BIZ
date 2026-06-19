'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs } from '@/components/ui/tabs'
import { SopForm } from './sop-form'
import { OnboardingTemplateForm } from './onboarding-template-form'
import { deleteSopAction } from '@/lib/actions/sops'
import { formatDate, cn } from '@/lib/utils'
import { SOP_TAGS } from '@/lib/types'
import type { Sop, OnboardingTemplate } from '@/lib/types'
import { Plus, Trash2, FileText } from 'lucide-react'

interface Props {
  sops: Sop[]
  templates: OnboardingTemplate[]
}


export function SopsList({ sops, templates }: Props) {
  const [showSopForm, setShowSopForm] = useState(false)
  const [showTemplateForm, setShowTemplateForm] = useState(false)
  const [editingSop, setEditingSop] = useState<Sop | null>(null)

  const [activeTag, setActiveTag] = useState<string>('all')
  const router = useRouter()

  const tabs = [
    { id: 'sops', label: 'SOPs', count: sops.length },
    { id: 'templates', label: 'Templates de Onboarding', count: templates.length },
  ]

  // Predefined tag filter (BIZ areas) + keep any legacy categories present in data
  const legacyCategories = ([...new Set(sops.map((s) => s.category).filter(Boolean))] as string[])
    .filter((c) => !(SOP_TAGS as readonly string[]).includes(c))
  const filterTags = ['all', ...SOP_TAGS, ...legacyCategories]

  const visibleSops = activeTag === 'all' ? sops : sops.filter((s) => s.category === activeTag)
  const categories = [...new Set(visibleSops.map((s) => s.category).filter(Boolean))]


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
                  <div className="flex flex-wrap gap-1.5">
                    {filterTags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => setActiveTag(tag)}
                        className={cn(
                          'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                          activeTag === tag
                            ? 'border-zinc-50 bg-zinc-50 text-zinc-950'
                            : 'border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                        )}
                      >
                        {tag === 'all' ? 'Todos' : tag}
                      </button>
                    ))}
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
                          <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-400 mb-3">{cat}</h3>
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

      {showSopForm && <SopForm onClose={() => { setShowSopForm(false); router.refresh() }} />}
      {editingSop && <SopForm sop={editingSop} onClose={() => { setEditingSop(null); router.refresh() }} />}
      {showTemplateForm && <OnboardingTemplateForm sops={sops} onClose={() => { setShowTemplateForm(false); router.refresh() }} />}
    </>
  )
}
