/**
 * Cliente de la API de Fathom.
 *
 * Fathom graba las llamadas solo (la cuenta está conectada a Google Meet), pero
 * la grabación se queda ahí: alguien tiene que ir a buscarla y pegarla en el
 * CRM. Esta API es lo que permite que el CRM la vaya a buscar.
 *
 * CONFIGURACIÓN
 *   FATHOM_API_KEY         se genera en Fathom → Settings → API Access → Generate Api Key
 *   FATHOM_WEBHOOK_SECRET  opcional: el secreto "whsec_..." del webhook, para
 *                          verificar la firma de /api/webhooks/fathom
 *
 * LIMITACIÓN DE LA KEY
 * Las keys de Fathom son por usuario: solo ven las reuniones que grabó ese
 * usuario o que se compartieron con su equipo. Las llamadas que un closer graba
 * con su propia cuenta no llegan mientras no las comparta con el equipo del
 * dueño de la key.
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
  name?: string | null
  email?: string | null
  email_domain?: string | null
  is_external?: boolean | null
}

export interface ReunionFathom {
  /**
   * La documentación y la API lo devuelven como número (123456789), aunque la
   * base lo guarda como texto. Compararlo sin normalizar hacía que ninguna
   * grabación ya asociada se reconociera. Usar siempre idDeReunion().
   */
  recording_id: number | string
  title?: string | null
  meeting_title?: string | null
  /** Enlace para ver la grabación. Es lo que termina en link_reporte. */
  share_url?: string | null
  url?: string | null
  meeting_url?: string | null
  created_at?: string | null
  /** La hora agendada. Es el cruce principal con la agenda del CRM. */
  scheduled_start_time?: string | null
  scheduled_end_time?: string | null
  recording_start_time?: string | null
  recording_end_time?: string | null
  calendar_invitees?: InvitadoFathom[] | null
  /** Quién grabó: la cuenta de Fathom, normalmente el closer. */
  recorded_by?: { name?: string | null; email?: string | null; team?: string | null } | null
  default_summary?: { template_name?: string | null; markdown_formatted?: string | null } | null
}

interface RespuestaLista {
  items?: ReunionFathom[]
  next_cursor?: string | null
  limit?: number | null
}

export function credencialesConfiguradas(): boolean {
  return !!process.env.FATHOM_API_KEY
}

/** El recording_id como texto, que es como lo guarda la base. */
export function idDeReunion(reunion: Pick<ReunionFathom, 'recording_id'>): string | null {
  const id = reunion.recording_id
  if (id === null || id === undefined || id === '') return null
  return String(id)
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

export interface PaginaReuniones {
  reuniones: ReunionFathom[]
  /** Cursor para seguir desde donde quedó. Null si ya no hay más páginas. */
  siguienteCursor: string | null
  paginas: number
}

/**
 * Reuniones desde una fecha, con el cursor para continuar.
 *
 * Existe aparte de listarReuniones para el backfill: recorrer dos meses de
 * grabaciones no cabe en los 60 segundos de una función, así que se trae de a
 * pocas páginas por invocación y se devuelve el cursor para la siguiente.
 */
export async function listarPaginaDeReuniones(opciones: {
  desde: Date
  hasta?: Date | null
  cursor?: string | null
  maxPaginas?: number
}): Promise<PaginaReuniones> {
  const maxPaginas = opciones.maxPaginas ?? 10
  const reuniones: ReunionFathom[] = []
  let cursor: string | null = opciones.cursor ?? null
  let paginas = 0

  do {
    const params = new URLSearchParams({
      created_after: opciones.desde.toISOString(),
      include_summary: 'true',
    })
    if (opciones.hasta) params.set('created_before', opciones.hasta.toISOString())
    if (cursor) params.set('cursor', cursor)

    const data: RespuestaLista = await llamar<RespuestaLista>(`/meetings?${params}`)
    reuniones.push(...(data.items ?? []))
    cursor = data.next_cursor ?? null
    paginas++
  } while (cursor && paginas < maxPaginas)

  return { reuniones, siguienteCursor: cursor, paginas }
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
  const { reuniones } = await listarPaginaDeReuniones({ desde, maxPaginas })
  return reuniones
}

/** Los invitados externos: el prospecto, no el equipo del negocio. */
export function invitadosExternos(invitados: InvitadoFathom[] | null | undefined): InvitadoFathom[] {
  return (invitados ?? []).filter((i) => i.is_external !== false)
}

/** Los correos de los invitados externos. */
export function correosExternos(reunion: Pick<ReunionFathom, 'calendar_invitees'>): string[] {
  return invitadosExternos(reunion.calendar_invitees)
    .filter((i) => i.email)
    .map((i) => i.email!.toLowerCase())
}
