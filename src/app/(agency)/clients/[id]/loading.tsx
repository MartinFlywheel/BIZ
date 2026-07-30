export default function ClientDetailLoading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-40 rounded-md bg-white/[0.06]" />
          <div className="h-3 w-56 rounded bg-white/[0.03]" />
        </div>
        <div className="h-9 w-24 rounded-lg bg-white/[0.04]" />
      </div>

      <div className="flex gap-1 border-b border-zinc-800">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-9 w-32 rounded-t bg-white/[0.04] mb-1" />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-24 rounded-xl bg-white/[0.03]" />
        ))}
      </div>
    </div>
  )
}
