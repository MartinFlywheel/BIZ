import { unstable_noStore } from 'next/cache'
import { notFound } from 'next/navigation'
import { getClient } from '@/lib/actions/clients'
import { getTaskBoard } from '@/lib/actions/tasks'
import { TasksWorkspace } from '@/components/tasks/tasks-workspace'

// La sincronización con Notion pagina de a 100 páginas y cada llamada tarda
// cerca de un segundo: con el presupuesto por defecto de Vercel, una base
// grande se corta a la mitad sin dejar error visible.
export const maxDuration = 60

export default async function ClientTasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  unstable_noStore()

  let data: [Awaited<ReturnType<typeof getClient>>, Awaited<ReturnType<typeof getTaskBoard>>]
  try {
    data = await Promise.all([getClient(id), getTaskBoard(id)])
  } catch {
    // getTaskBoard tira si el usuario no es admin y el cliente no es el suyo.
    notFound()
  }

  const [client, board] = data
  return <TasksWorkspace clientId={id} clientName={client.name} initialData={board} />
}
