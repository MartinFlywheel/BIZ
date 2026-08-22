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
  // Fired when the user switches to a different tab — lets a consumer that
  // lazy-fetches per tab (clients/[id]) know which tabs to keep mounted
  // instead of tearing them down and refetching every time they're revisited.
  onTabChange?: (id: string) => void
  children: (activeTab: string) => React.ReactNode
}

export function Tabs({ tabs, defaultTab, onTabChange, children }: TabsProps) {
  const [active, setActive] = useState(defaultTab || tabs[0]?.id)

  function handleTabChange(id: string) {
    if (id === active) return
    setActive(id)
    onTabChange?.(id)
  }

  return (
    <div>
      {/* Tab bar — horizontally scrollable with touch on mobile where it overflows */}
      <div className="relative flex gap-1 overflow-x-auto border-b border-zinc-800 mb-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={cn(
              'relative shrink-0 px-4 py-2.5 text-sm font-medium transition-all duration-200 border-b-2 -mb-px',
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

      <div className="tab-enter">
        {children(active)}
      </div>
    </div>
  )
}
