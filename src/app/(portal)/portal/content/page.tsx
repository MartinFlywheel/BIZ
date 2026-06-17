import { createClient } from '@/lib/supabase/server'
import { getContentPieces } from '@/lib/actions/content'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatNumber, formatDate } from '@/lib/utils'
import { redirect } from 'next/navigation'

export default async function PortalContentPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('client_id')
    .eq('id', user.id)
    .single()

  if (!profile?.client_id) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-zinc-50">Mi Contenido</h1>
        <Card>
          <div className="flex h-48 items-center justify-center text-zinc-500">
            Sin cliente asignado
          </div>
        </Card>
      </div>
    )
  }

  const contentPieces = await getContentPieces(profile.client_id)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Mi Contenido</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {contentPieces.length} pieza{contentPieces.length !== 1 ? 's' : ''} de contenido
        </p>
      </div>

      {contentPieces.length === 0 ? (
        <Card>
          <div className="flex h-48 items-center justify-center text-zinc-500">
            No hay contenido registrado
          </div>
        </Card>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Tipo</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Caption</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">Views</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">Likes</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">Saves</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {contentPieces.map((cp) => (
                <tr key={cp.id} className="hover:bg-zinc-800/50">
                  <td className="px-4 py-3"><Badge>{cp.content_type}</Badge></td>
                  <td className="px-4 py-3 text-sm text-zinc-300 max-w-[200px] truncate">{cp.caption || '—'}</td>
                  <td className="px-4 py-3 text-sm text-zinc-200 text-right font-medium">{formatNumber(cp.views)}</td>
                  <td className="px-4 py-3 text-sm text-zinc-400 text-right">{formatNumber(cp.likes)}</td>
                  <td className="px-4 py-3 text-sm text-zinc-400 text-right">{formatNumber(cp.saves)}</td>
                  <td className="px-4 py-3 text-sm text-zinc-500">{cp.published_at ? formatDate(cp.published_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
