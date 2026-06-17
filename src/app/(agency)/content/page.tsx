import { getContentPieces } from '@/lib/actions/content'
import { getClients } from '@/lib/actions/clients'
import { ContentList } from '@/components/content/content-list'

export default async function ContentPage() {
  const [contentPieces, clients] = await Promise.all([
    getContentPieces(),
    getClients(),
  ])

  return (
    <div className="space-y-6">
      <ContentList contentPieces={contentPieces as any} clients={clients} />
    </div>
  )
}
