import type { NextRequest } from 'next/server'
import { handlePieceWebhook } from '@/lib/manychat'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// New URL — place this node at the CTA/trigger in the ManyChat flow. Every
// call registers a chat_abierto.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pieceId: string }> }
) {
  const { pieceId } = await params
  return handlePieceWebhook(request, pieceId, 'chat_abierto')
}
