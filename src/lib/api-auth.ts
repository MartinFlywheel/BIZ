import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Protege las rutas internas (/api/debug/*) con la misma contraseña que
 * Vercel manda a los crons: "Authorization: Bearer <CRON_SECRET>".
 *
 * Devuelve la respuesta 401 que hay que retornar, o null si la llamada es
 * válida. Si CRON_SECRET no está configurado, se niega todo: una ruta de
 * diagnóstico abierta por accidente es peor que una que no responde.
 */
export function exigirCronSecret(request: Request): NextResponse | null {
  const secreto = process.env.CRON_SECRET
  const header = request.headers.get('authorization')
  if (!secreto || header !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  return null
}

/**
 * Protege los webhooks de ManyChat con un token compartido
 * (MANYCHAT_WEBHOOK_TOKEN). Se acepta en la URL (?token=...) porque el nodo
 * "External Request" de ManyChat es más fácil de editar ahí, o en la
 * cabecera X-Webhook-Token.
 *
 * Si la variable no está configurada, deja pasar: primero se agrega el
 * token a las URL en ManyChat y recién después se configura la variable en
 * Vercel. Al revés cortaría los flujos.
 */
export function exigirTokenManyChat(request: Request): NextResponse | null {
  const esperado = process.env.MANYCHAT_WEBHOOK_TOKEN
  if (!esperado) return null
  const url = new URL(request.url)
  const recibido = url.searchParams.get('token') ?? request.headers.get('x-webhook-token') ?? ''
  if (recibido !== esperado) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  return null
}

export interface AgenteAutenticado {
  clientId: string
  keyId: string
}

function hashLlave(llave: string): string {
  return createHash('sha256').update(llave).digest('hex')
}

/**
 * Autentica una llamada a /api/agent/v1/* con la llave por cliente creada
 * por crear_api_key_cliente() (supabase/060-client-api-keys.sql).
 *
 * La llave viaja en "Authorization: Bearer bzk_...". Se compara por hash,
 * nunca en claro. Si la tabla todavía no existe (migración 060 sin correr,
 * código 42P01) se responde 503 con un mensaje claro, en vez de un 401 que
 * haría pensar que la llave está mal.
 */
export async function autenticarAgente(
  supabase: AdminClient,
  request: Request
): Promise<{ agente: AgenteAutenticado; error: null } | { agente: null; error: NextResponse }> {
  const header = request.headers.get('authorization') ?? ''
  const llave = header.startsWith('Bearer ') ? header.slice(7).trim() : ''

  if (!llave.startsWith('bzk_')) {
    return { agente: null, error: NextResponse.json({ error: 'Falta la llave de acceso' }, { status: 401 }) }
  }

  const { data, error } = await supabase
    .from('client_api_keys')
    .select('id, client_id, revoked_at')
    .eq('key_hash', hashLlave(llave))
    .maybeSingle()

  if (error?.code === '42P01') {
    return {
      agente: null,
      error: NextResponse.json({ error: 'La API del agente todavía no está habilitada en la base' }, { status: 503 }),
    }
  }

  if (!data || data.revoked_at) {
    return { agente: null, error: NextResponse.json({ error: 'Llave inválida o revocada' }, { status: 401 }) }
  }

  // Solo informativo: si falla no bloquea la llamada.
  void supabase
    .from('client_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => undefined, () => undefined)

  return { agente: { clientId: data.client_id, keyId: data.id }, error: null }
}
