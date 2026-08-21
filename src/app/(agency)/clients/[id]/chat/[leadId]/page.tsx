import { unstable_noStore } from 'next/cache'
import { notFound } from 'next/navigation'
import { getLeadChatHeader } from '@/lib/actions/lead-chat'
import { LeadChatView } from '@/components/clients/lead-chat-view'

export default async function LeadChatPage({
  params,
}: {
  params: Promise<{ id: string; leadId: string }>
}) {
  const { id, leadId } = await params
  unstable_noStore()

  try {
    const header = await getLeadChatHeader(leadId)
    return (
      <LeadChatView
        leadId={leadId}
        clientId={id}
        fullName={header.fullName}
        igUsername={header.igUsername}
      />
    )
  } catch {
    notFound()
  }
}
