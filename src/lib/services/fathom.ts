/**
 * Cliente de la API de Fathom.
 *
 * Fathom graba las llamadas solo (la cuenta está conectada a Google Meet), pero
 * la grabación se queda ahí: alguien tiene que ir a buscarla y pegarla en el
 * CRM. Esta API es lo que permite que el CRM la vaya a buscar.
 *
 * CONFIGURACIÓN
 *   FATHOM_API_KEY  se genera en Fathom → Settings → API Access → Generate Api Key
 *
 * Docs: https://developers.fathom.ai/api-reference/meetings/list-meetings
 */

const API = 'https://api.fathom.ai/external/v1'

export class FathomError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'FathomError'
  }
}

export interface InvitadoFathom {
  name?: string
  email?: string
  email_domain?: string
  is_external?: boolean
}

export interface ReunionFathom {
  recording_id: string
  title?: string
  meeting_title?: string
  /** Enlace para ver la grabación. Es lo que termina en link_reporte. */
  share_url?: string
  url?: string
  meeting_url?: string
  created_at?: string
  /** La hora agendada. Es el cruce principal con la agenda del CRM. */
  scheduled_start_time?: string
  scheduled_end_time?: string
  recording_start_time?: string
  recording_end_time?: string
  calendar_invitees?: InvitadoFathom[]
  default_summary?: { template_name?: string; markdown_formatted?: string }
}

interface RespuestaLista {
  items?: ReunionFathom[]
  next_cursor?: string | null
  limit?: number | null
}

export function credencialesConfiguradas(): boolean {
  return !!process.env.FATHOM_API_KEY
}

async function llamar<T>(ruta: string): Promise<T> {
  const key = process.env.FATHOM_API_KEY
  if (!key) throw new FathomError('Falta FATHOM_API_KEY')

  const res = await fetch(`${API}${ruta}`, {
    headers: { 'X-Api-Key': key, Accept: 'application/json' },
  })

  if (!res.ok) {
    const detalle = await res.text()
    throw new FathomError(
      `Fathom respondió ${res.status}: ${detalle.slice(0, 300)}`,
      res.status
    )
  }

  return res.json() as Promise<T>
}

/**
 * Las reuniones grabadas desde una fecha.
 *
 * Se piden con resumen incluido para no tener que volver a consultar cada
 * reunión por separado. El transcript no: son varios miles de líneas por
 * llamada y el CRM no lo muestra en ninguna parte.
 *
 * `maxPaginas` acota cuánto se pagina hacia atrás. Sin ese tope, la primera
 * corrida sobre una cuenta con años de grabaciones recorrería todo el historial
 * dentro del timeout de la función.
 */
export async function listarReuniones(
  desde: Date,
  maxPaginas = 10
): Promise<ReunionFathom[]> {
  const reuniones: ReunionFathom[] = []
  let cursor: string | null = null
  let pagina = 0

  do {
    const params = new URLSearchParams({
      created_after: desde.toISOString(),
      include_summary: 'true',
    })
    if (cursor) params.set('cursor', cursor)

    const data: RespuestaLista = await llamar<RespuestaLista>(`/meetings?${params}`)
    reuniones.push(...(data.items ?? []))
    cursor = data.next_cursor ?? null
    pagina++
  } while (cursor && pagina < maxPaginas)

  return reuniones
}

/** Los correos de los invitados externos: el prospecto, no el equipo del negocio. */
export function correosExternos(reunion: ReunionFathom): string[] {
  return (reunion.calendar_invitees ?? [])
    .filter((i) => i.email && i.is_external !== false)
    .map((i) => i.email!.toLowerCase())
}
