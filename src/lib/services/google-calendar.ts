import { createSign } from 'crypto'

/**
 * Acceso a Google Calendar con una cuenta de servicio.
 *
 * POR QUÉ CUENTA DE SERVICIO Y NO OAUTH
 * OAuth obligaría a pantalla de consentimiento, revisión de Google y a guardar
 * y renovar refresh tokens por cada cuenta conectada. Una cuenta de servicio
 * se comporta como una persona más: su correo
 * (algo@proyecto.iam.gserviceaccount.com) se agrega en "Compartir con
 * determinadas personas" del calendario, con permiso "Hacer cambios en los
 * eventos". Nada que consentir, nada que expire, y el permiso de escritura es
 * el que después deja invitar sola a la notetaker de Fathom.
 *
 * POR QUÉ SIN SDK
 * `googleapis` son varios megas para usar dos endpoints. Acá se firma el JWT a
 * mano con el `crypto` de Node y se llama la API REST con fetch.
 *
 * CONFIGURACIÓN (variables de entorno en Vercel)
 *   GOOGLE_SA_EMAIL        correo de la cuenta de servicio
 *   GOOGLE_SA_PRIVATE_KEY  la clave privada del JSON descargado
 *
 * El calendario a leer NO va acá: vive en clients.google_calendar_id, porque
 * cada cliente tiene el suyo.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://www.googleapis.com/calendar/v3'

// Lectura y escritura: el pipeline necesita escribir para agregar a la
// notetaker como invitada del evento.
const SCOPE = 'https://www.googleapis.com/auth/calendar.events'

export class GoogleCalendarError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'GoogleCalendarError'
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * La clave privada tal como la guarda Vercel.
 *
 * En el JSON de Google los saltos de línea son `\n` reales; al pegarla en una
 * variable de entorno quedan como los dos caracteres `\` y `n`, y el módulo
 * crypto no la acepta así. Se aceptan las dos formas para que no dependa de
 * cómo se haya pegado.
 */
function leerClavePrivada(): string {
  const raw = process.env.GOOGLE_SA_PRIVATE_KEY
  if (!raw) throw new GoogleCalendarError('Falta GOOGLE_SA_PRIVATE_KEY')
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw
}

// El token dura una hora; se reusa mientras siga vivo en vez de pedir uno por
// cada llamada. El sync hace varias seguidas.
let cache: { token: string; expiraEn: number } | null = null

async function obtenerToken(): Promise<string> {
  if (cache && Date.now() < cache.expiraEn - 60_000) return cache.token

  const email = process.env.GOOGLE_SA_EMAIL
  if (!email) throw new GoogleCalendarError('Falta GOOGLE_SA_EMAIL')

  const ahora = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(
    JSON.stringify({
      iss: email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: ahora,
      exp: ahora + 3600,
    })
  )

  const firma = createSign('RSA-SHA256')
  firma.update(`${header}.${claims}`)
  const jwt = `${header}.${claims}.${base64url(firma.sign(leerClavePrivada()))}`

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  if (!res.ok) {
    const detalle = await res.text()
    throw new GoogleCalendarError(
      `Google rechazó las credenciales de la cuenta de servicio (HTTP ${res.status}): ${detalle.slice(0, 200)}`,
      res.status
    )
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }
  cache = { token: data.access_token, expiraEn: Date.now() + data.expires_in * 1000 }
  return data.access_token
}

async function llamar<T>(ruta: string, init?: RequestInit): Promise<T> {
  const token = await obtenerToken()
  const res = await fetch(`${API}${ruta}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!res.ok) {
    const detalle = await res.text()
    throw new GoogleCalendarError(
      `Google Calendar respondió ${res.status}: ${detalle.slice(0, 300)}`,
      res.status
    )
  }

  return res.json() as Promise<T>
}

export interface EventoGoogle {
  id: string
  status: 'confirmed' | 'tentative' | 'cancelled'
  summary?: string
  description?: string
  location?: string
  hangoutLink?: string
  htmlLink?: string
  created?: string
  updated?: string
  start?: { dateTime?: string; date?: string; timeZone?: string }
  end?: { dateTime?: string; date?: string; timeZone?: string }
  attendees?: {
    email: string
    displayName?: string
    responseStatus?: string
    /** El dueño del evento: la cuenta del negocio, no el prospecto. */
    organizer?: boolean
    /** La propia cuenta que hace la consulta. */
    self?: boolean
    /** Salas y recursos, que no son personas. */
    resource?: boolean
  }[]
  organizer?: { email?: string; displayName?: string; self?: boolean }
}

export interface ResultadoEventos {
  eventos: EventoGoogle[]
  /** syncToken para la próxima vuelta. Null si Google no lo devolvió. */
  syncToken: string | null
  /**
   * Google invalidó el token y hay que releer desde cero. Pasa cuando pasó
   * demasiado tiempo desde la última sincronización.
   */
  tokenExpirado: boolean
}

/**
 * Los cambios del calendario desde la última vuelta.
 *
 * Con `syncToken` Google devuelve sólo lo que cambió —altas, ediciones y
 * cancelaciones— en vez del calendario entero. Sin él (primera vez, o token
 * invalidado) se lee una ventana acotada hacia adelante: el histórico no
 * interesa, las agendas que importan son las que están por venir.
 *
 * Se pagina hasta el final porque el syncToken sólo viene en la última página;
 * cortar antes dejaría el token sin guardar y la próxima vuelta releería todo.
 */
export async function listarCambios(
  calendarId: string,
  syncToken: string | null,
  diasHaciaAtras = 7
): Promise<ResultadoEventos> {
  const eventos: EventoGoogle[] = []
  let pageToken: string | undefined
  let nuevoSyncToken: string | null = null

  do {
    const params = new URLSearchParams({
      singleEvents: 'true',
      maxResults: '250',
      // Necesario para que las cancelaciones lleguen como status=cancelled en
      // vez de simplemente desaparecer del listado.
      showDeleted: 'true',
    })

    if (syncToken) {
      params.set('syncToken', syncToken)
    } else {
      const desde = new Date(Date.now() - diasHaciaAtras * 86_400_000)
      params.set('timeMin', desde.toISOString())
      params.set('orderBy', 'startTime')
    }
    if (pageToken) params.set('pageToken', pageToken)

    try {
      const data = await llamar<{
        items?: EventoGoogle[]
        nextPageToken?: string
        nextSyncToken?: string
      }>(`/calendars/${encodeURIComponent(calendarId)}/events?${params}`)

      eventos.push(...(data.items ?? []))
      pageToken = data.nextPageToken
      if (data.nextSyncToken) nuevoSyncToken = data.nextSyncToken
    } catch (e) {
      // 410 Gone = el syncToken caducó. Se avisa para que el llamador vuelva a
      // pedir sin token, en vez de quedarse sin sincronizar para siempre.
      if (e instanceof GoogleCalendarError && e.status === 410) {
        return { eventos: [], syncToken: null, tokenExpirado: true }
      }
      throw e
    }
  } while (pageToken)

  return { eventos, syncToken: nuevoSyncToken, tokenExpirado: false }
}

/**
 * Agrega a alguien como invitado de un evento sin tocar los demás invitados.
 *
 * Se usa para meter a la notetaker de Fathom: como está invitada, Fathom la ve
 * en su propio calendario y entra sola a la llamada — que es lo que elimina el
 * trabajo manual del director.
 *
 * `sendUpdates=none` a propósito: el prospecto no tiene por qué recibir un
 * correo diciendo que se sumó una cuenta desconocida a su reunión.
 *
 * Google reemplaza la lista completa de asistentes, así que primero se lee el
 * evento y se manda la lista existente más el nuevo. Mandar sólo al invitado
 * nuevo borraría al prospecto de su propia reunión.
 */
export async function invitarAEvento(
  calendarId: string,
  eventId: string,
  email: string
): Promise<{ agregado: boolean }> {
  const evento = await llamar<EventoGoogle>(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
  )

  const actuales = evento.attendees ?? []
  if (actuales.some((a) => a.email?.toLowerCase() === email.toLowerCase())) {
    return { agregado: false }
  }

  await llamar(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    {
      method: 'PATCH',
      body: JSON.stringify({ attendees: [...actuales, { email }] }),
    }
  )

  return { agregado: true }
}

/** Si el módulo está configurado. Sin esto el sync ni siquiera debería intentar. */
export function credencialesConfiguradas(): boolean {
  return !!process.env.GOOGLE_SA_EMAIL && !!process.env.GOOGLE_SA_PRIVATE_KEY
}
