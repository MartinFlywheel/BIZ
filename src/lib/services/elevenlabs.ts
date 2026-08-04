import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Generate a voice note from text via ElevenLabs, upload it to the
 * `product-audio` Supabase Storage bucket, and return its public URL —
 * both the Dashboard <audio> player and the WhatsApp Graph API need a
 * plain public link, not raw bytes.
 */
export async function generateVoiceNote(text: string, studentId: string): Promise<string> {
  const voiceId = process.env.ELEVENLABS_MANE_VOICE_ID
  const apiKey = process.env.ELEVENLABS_API_KEY

  if (!voiceId || !apiKey) {
    throw new Error('ElevenLabs API Key or Voice ID is missing in environment variables.')
  }

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=ogg_48000_192`, {
    method: 'POST',
    headers: {
      Accept: 'audio/ogg',
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('ElevenLabs error:', errorText)
    throw new Error(`ElevenLabs Error: ${response.statusText}`)
  }

  const audioBuffer = await response.arrayBuffer()
  const path = `${studentId}/${Date.now()}.ogg`

  const supabase = createAdminClient()
  const { error: uploadError } = await supabase.storage
    .from('product-audio')
    .upload(path, audioBuffer, { contentType: 'audio/ogg', upsert: false })

  if (uploadError) {
    console.error('Supabase Storage upload error:', uploadError.message)
    throw new Error('Failed to store generated audio')
  }

  const { data } = supabase.storage.from('product-audio').getPublicUrl(path)
  return data.publicUrl
}
