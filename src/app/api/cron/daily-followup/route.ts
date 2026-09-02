import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logCronRun } from '@/lib/cron-log'
import { generateFollowUpMessage } from '@/lib/services/openai'
import { generateVoiceNote } from '@/lib/services/elevenlabs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Runs once a day (configured in vercel.json / hosting cron). Drafts that
// day's follow-up per active student and queues it in ai_messages_queue for
// Mane to approve from the Producto tab — nothing is sent automatically.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const supabase = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  try {
    const { data: students, error } = await supabase
      .from('program_students')
      .select('*')

    if (error) throw error

    let queued = 0
    let skipped = 0

    for (const student of students || []) {
      // Idempotency: don't draft a second message for the same student on
      // the same calendar day if the cron re-runs or overlaps.
      const { data: existingToday } = await supabase
        .from('ai_messages_queue')
        .select('id')
        .eq('student_id', student.id)
        .gte('generated_at', `${today}T00:00:00Z`)
        .limit(1)
        .maybeSingle()

      if (existingToday) {
        skipped++
        continue
      }

      try {
        const messageText = await generateFollowUpMessage(student)

        // Milestone days get a cloned-voice audio note instead of plain text.
        let audioUrl: string | null = null
        if ([3, 7, 14].includes(student.current_day)) {
          audioUrl = await generateVoiceNote(messageText, student.id)
        }

        await supabase.from('ai_messages_queue').insert({
          student_id: student.id,
          message_text: messageText,
          audio_url: audioUrl,
          status: 'pending',
        })

        queued++
      } catch (perStudentError) {
        console.error(`[DailyFollowUp] Failed for student ${student.id}:`, perStudentError)
      }
    }

    await logCronRun('daily-followup', {
      encolados: queued,
      omitidos: skipped,
      total: students?.length || 0,
    })

    return NextResponse.json({ success: true, queued, skipped, total: students?.length || 0 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    console.error('[DailyFollowUp] Fatal error:', msg)
    // Registrar también el fallo: un cron que revienta y no deja rastro es
    // indistinguible de uno que nunca se disparó.
    await logCronRun('daily-followup', { fallo: 'error fatal', error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
