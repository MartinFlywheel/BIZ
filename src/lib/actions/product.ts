'use server'

import { createClient } from '@/lib/supabase/server'
import { sendWhatsAppAudio, sendWhatsAppText } from '@/lib/services/meta-whatsapp'

export async function approveAiMessage(messageId: string) {
  const supabase = await createClient()

  const { data: queued, error } = await supabase
    .from('ai_messages_queue')
    .select('*, program_students(phone)')
    .eq('id', messageId)
    .single()

  if (error || !queued) throw new Error('Mensaje no encontrado')

  const phone = queued.program_students?.phone
  if (!phone) throw new Error('La alumna no tiene teléfono registrado')

  if (queued.message_text) await sendWhatsAppText(phone, queued.message_text)
  if (queued.audio_url) await sendWhatsAppAudio(phone, queued.audio_url)

  await supabase
    .from('ai_messages_queue')
    .update({ status: 'sent', reviewed_at: new Date().toISOString() })
    .eq('id', messageId)

  await supabase.from('student_messages').insert({
    student_id: queued.student_id,
    sender: 'ai',
    message_text: queued.message_text,
    audio_url: queued.audio_url,
  })
}

export async function rejectAiMessage(messageId: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('ai_messages_queue')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .eq('id', messageId)

  if (error) throw new Error(error.message)
}

export async function sendManualMessage(studentId: string, phone: string, text: string) {
  if (!text.trim()) return
  const supabase = await createClient()

  await sendWhatsAppText(phone, text)

  const { error } = await supabase.from('student_messages').insert({
    student_id: studentId,
    sender: 'agency',
    message_text: text,
  })

  if (error) throw new Error(error.message)
}
