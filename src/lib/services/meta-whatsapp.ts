/**
 * Send a text message via WhatsApp using the Meta Graph API.
 * @param to The recipient's phone number.
 * @param text The text message to send.
 */
export async function sendWhatsAppText(to: string, text: string) {
  const token = process.env.META_WHATSAPP_TOKEN
  const phoneId = process.env.META_WHATSAPP_PHONE_ID

  if (!token || !phoneId) {
    throw new Error('Meta WhatsApp configuration is missing.')
  }

  const response = await fetch(`https://graph.facebook.com/v17.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to,
      type: 'text',
      text: {
        body: text,
      },
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Meta API Error:', errorData)
    throw new Error('Failed to send WhatsApp text')
  }

  return await response.json()
}

/**
 * Send an audio message (voice note) via WhatsApp using the Meta Graph API.
 * @param to The recipient's phone number.
 * @param audioUrl The public URL of the .ogg audio file.
 */
export async function sendWhatsAppAudio(to: string, audioUrl: string) {
  const token = process.env.META_WHATSAPP_TOKEN
  const phoneId = process.env.META_WHATSAPP_PHONE_ID

  if (!token || !phoneId) {
    throw new Error('Meta WhatsApp configuration is missing.')
  }

  const response = await fetch(`https://graph.facebook.com/v17.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to,
      type: 'audio',
      audio: {
        link: audioUrl,
      },
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Meta API Error:', errorData)
    throw new Error('Failed to send WhatsApp audio')
  }

  return await response.json()
}
