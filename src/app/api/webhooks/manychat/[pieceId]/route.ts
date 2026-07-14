import type { NextRequest } from 'next/server'
import { handlePieceWebhook } from '@/lib/manychat'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// The original webhook URL — already wired in ManyChat to the "Solicitud
// externa" node that only fires after the prospect replies. Every call
// registers (or promotes) a conversacion_real.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pieceId: string }> }
) {
  const { pieceId } = await params
  return handlePieceWebhook(request, pieceId, 'conversacion_real')
}
