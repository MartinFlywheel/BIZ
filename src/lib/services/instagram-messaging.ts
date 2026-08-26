// Sends a direct message via the Instagram Messaging API, using the same
// System User Token + graph.instagram.com pattern already used to read
// Reels/content in src/lib/actions/instagram.ts — no per-client OAuth,
// the System User already has access to every connected client account.
export async function sendInstagramDM(igAccountId: string, recipientIgsid: string, text: string): Promise<void> {
  const token = process.env.META_SYSTEM_USER_TOKEN
  if (!token) {
    throw new Error('META_SYSTEM_USER_TOKEN not configured')
  }

  const response = await fetch(`https://graph.facebook.com/v21.0/${igAccountId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      recipient: { id: recipientIgsid },
      message: { text },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Instagram send error:', errorText)
    throw new Error('No se pudo enviar el mensaje de Instagram')
  }
}
