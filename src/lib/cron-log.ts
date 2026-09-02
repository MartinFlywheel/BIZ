import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Registra el resultado de una corrida de cron en `cron_runs`.
 *
 * Los logs de ejecución de Vercel se retienen pocas horas, así que la respuesta
 * JSON de la ruta es irrecuperable pasado ese plazo. Esta tabla guarda una fila
 * por corrida para poder responder "¿corrió?" y "¿hizo algo?" en cualquier
 * momento, no solo justo después de que se dispare.
 *
 * Importante: el panel de Usage de Vercel cuenta invocaciones, no éxitos — un
 * 401 o un crash también suman ahí. Esta tabla es la única fuente que distingue
 * "se invocó" de "terminó bien".
 *
 * Nunca lanza. Que falle el registro no debe tumbar el trabajo que el cron ya
 * hizo, así que un error se reporta por consola y la ruta sigue su curso.
 */
export async function logCronRun(
  jobName: string,
  summary: Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await createAdminClient()
      .from('cron_runs')
      .insert({ job_name: jobName, summary })

    if (error) {
      console.error(`[cron-log] no se pudo registrar "${jobName}": ${error.message}`)
    }
  } catch (e) {
    console.error(`[cron-log] no se pudo registrar "${jobName}":`, e)
  }
}
