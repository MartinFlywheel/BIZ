import type { NextRequest } from 'next/server'
import { handlePieceWebhook } from '@/lib/manychat'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Place this node after the prospect actually replies in the ManyChat flow —
// every call registers (or promotes) a conversacion_real, regardless of the
// payload body.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pieceId: string }> }
) {
  const { pieceId } = await params
  return handlePieceWebhook(request, pieceId, 'conversacion_real')
}
