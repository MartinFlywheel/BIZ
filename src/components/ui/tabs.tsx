'use client'

import { cn } from '@/lib/utils'
import { useState, useRef } from 'react'

interface Tab {
  id: string
  label: string
  count?: number
}

interface TabsProps {
  tabs: Tab[]
  defaultTab?: string
  children: (activeTab: string) => React.ReactNode
}

export function Tabs({ tabs, defaultTab, children }: TabsProps) {
  const [active, setActive] = useState(defaultTab || tabs[0]?.id)
  // Key increments on every tab switch to force re-mount of the animation
  const [contentKey, setContentKey] = useState(0)
  const prevTab = useRef(active)

  function handleTabChange(id: string) {
    if (id === active) return
    prevTab.current = active
    setActive(id)
    setContentKey((k) => k + 1)
  }

  return (
    <div>
      {/* Tab bar */}
      <div className="relative flex gap-1 border-b border-zinc-800 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={cn(
              'relative px-4 py-2.5 text-sm font-medium transition-all duration-200 border-b-2 -mb-px',
              active === tab.id
                ? 'border-zinc-50 text-zinc-50'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={cn(
                'ml-2 rounded-full px-2 py-0.5 text-xs transition-colors duration-200',
                active === tab.id
                  ? 'bg-zinc-700 text-zinc-300'
                  : 'bg-zinc-800 text-zinc-500'
              )}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Animated content panel — re-keyed on every tab switch */}
      <div key={contentKey} className="tab-enter">
        {children(active)}
      </div>
    </div>
  )
}
