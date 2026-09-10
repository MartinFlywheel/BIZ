import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Los crons declarados en vercel.json. Se listan explícitamente para poder
// mostrar "nunca_registrado" en los que no tienen ninguna fila: un job ausente
// del log es justo el caso que interesa detectar, y consultando solo la tabla
// nunca aparecería.
// Cada job con su propio margen, porque no todos corren igual de seguido. Los
// diarios llevan 36 h por la deriva de Vercel; los que corren cada pocos
// minutos se dan por caidos mucho antes, o un job muerto pasaria un dia entero
// como "ok".
const JOBS: { nombre: string; horasParaAtraso: number }[] = [
  { nombre: 'sync-instagram', horasParaAtraso: 36 },
  { nombre: 'sync-instagram-stories', horasParaAtraso: 36 },
  { nombre: 'refresh-tokens', horasParaAtraso: 36 },
  { nombre: 'check-benchmarks', horasParaAtraso: 36 },
  { nombre: 'process-webhooks', horasParaAtraso: 36 },
  { nombre: 'daily-followup', horasParaAtraso: 36 },
  { nombre: 'prune-stale-leads', horasParaAtraso: 36 },
  // Los del pipeline de agendas, agendados desde pg_cron.
  { nombre: 'sync-agendas', horasParaAtraso: 2 },
  { nombre: 'triage-sweep', horasParaAtraso: 2 },
  { nombre: 'sync-fathom', horasParaAtraso: 3 },
]

interface Fila {
  job: string
  estado: 'ok' | 'atrasado' | 'nunca_registrado' | 'no_declarado'
  hace_horas: number | null
  ultima_corrida: string | null
  summary: unknown
}

export async function GET(request: Request) {
  const supabase = createAdminClient()
  const jobName = new URL(request.url).searchParams.get('job')

  // ?job=x → historial de ese job, para mirar la evolución de sus resúmenes.
  if (jobName) {
    const { data: runs, error } = await supabase
      .from('cron_runs')
      .select('job_name, ran_at, summary')
      .eq('job_name', jobName)
      .order('ran_at', { ascending: false })
      .limit(20)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ job: jobName, runs })
  }

  // Sin parámetro → la última corrida de CADA job. Antes devolvía las 20 más
  // recientes mezcladas, donde un job diario quedaba tapado por otro que corre
  // seguido — justo cuando hace falta ver el que falta.
  const { data: recent, error } = await supabase
    .from('cron_runs')
    .select('job_name, ran_at, summary')
    .order('ran_at', { ascending: false })
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ultima = new Map<string, { ran_at: string; summary: unknown }>()
  for (const run of recent ?? []) {
    if (!ultima.has(run.job_name)) {
      ultima.set(run.job_name, { ran_at: run.ran_at, summary: run.summary })
    }
  }

  const ahora = Date.now()

  // horasParaAtraso null = el job no esta declarado aqui, asi que no hay contra
  // que medirlo.
  function fila(job: string, horasParaAtraso: number | null): Fila {
    const run = ultima.get(job)
    if (!run) {
      return { job, estado: 'nunca_registrado', hace_horas: null, ultima_corrida: null, summary: null }
    }
    const horas = Math.round((ahora - new Date(run.ran_at).getTime()) / 3_600_000)
    return {
      job,
      estado: horasParaAtraso === null ? 'no_declarado' : horas > horasParaAtraso ? 'atrasado' : 'ok',
      hace_horas: horas,
      ultima_corrida: run.ran_at,
      summary: run.summary,
    }
  }

  // Un job que loguea pero no está en JOBS (uno nuevo, o uno agendado desde
  // pg_cron en vez de vercel.json) igual aparece, para que la lista no mienta
  // por omisión.
  const extras = [...ultima.keys()].filter((job) => !JOBS.some((j) => j.nombre === job))

  const jobs: Fila[] = [
    ...JOBS.map((j) => fila(j.nombre, j.horasParaAtraso)),
    ...extras.map((job) => fila(job, null)),
  ]

  return NextResponse.json({
    revisado_en: new Date().toISOString(),
    con_problemas: jobs.filter((j) => j.estado === 'atrasado' || j.estado === 'nunca_registrado').length,
    jobs,
  })
}
