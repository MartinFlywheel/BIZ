'use client'

import { cn } from '@/lib/utils'
import { useState } from 'react'

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

  return (
    <div>
      <div className="flex gap-1 border-b border-zinc-800 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
              active === tab.id
                ? 'border-zinc-50 text-zinc-50'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-2 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>
      {children(active)}
    </div>
  )
}
