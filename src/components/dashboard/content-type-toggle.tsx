'use client'

import { useRouter, useSearchParams } from 'next/navigation'

const OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Todo' },
  { value: 'reel', label: 'Reels' },
  { value: 'story', label: 'Historias' },
]

export function ContentTypeToggle({ selected }: { selected?: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function handleSelect(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set('type', value)
    else params.delete('type')
    router.push(`/dashboard?${params.toString()}`)
  }

  return (
    <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => handleSelect(opt.value)}
          className={`rounded-md px-3 h-7 text-xs font-medium transition-colors ${
            (selected || '') === opt.value
              ? 'bg-white/[0.1] text-zinc-100'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
