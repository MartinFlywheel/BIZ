import { createHmac } from 'node:crypto'

// Firma un token puente de vida corta y un solo uso para el bot ATV
// Consultor — un proyecto de Vercel totalmente aparte, sin conocimiento de
// Supabase ni de la tabla `users`. El bot verifica esto con el mismo
// ATV_BOT_ACCESS_SECRET y lo cambia por su propia cookie de sesión (ver
// atv-agent-prototype/src/lib/auth-token.ts + src/proxy.ts).
//
// Deliberadamente no es un JWT: un solo algoritmo, un solo secreto
// compartido, sin rotación de claves, nadie más lo parsea — un sobre HMAC
// mínimo cubre lo que hace falta sin sumar una dependencia nueva.

const BRIDGE_TOKEN_PURPOSE = 'atv-bridge'
// Solo tiene que sobrevivir un salto de redirect, no una sesión de
// navegación — se mantiene corto para achicar la ventana de replay si la
// URL llegara a quedar expuesta (logs del servidor, historial del
// navegador del salto intermedio, etc).
const BRIDGE_TOKEN_TTL_MS = 2 * 60 * 1000

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url')
}

// userId/userName viajan en el payload firmado para que el bot pueda
// atribuir cada conversación compartida a quién la inició, sin tener que
// volver a consultarle nada a biz-crm en cada request — el bot arrastra
// estos mismos campos a su propia cookie de sesión al cambiar este token.
export function signAtvBotBridgeToken(
  secret: string,
  identity?: { userId: string; userName?: string | null }
): string {
  const payload = JSON.stringify({
    purpose: BRIDGE_TOKEN_PURPOSE,
    exp: Date.now() + BRIDGE_TOKEN_TTL_MS,
    userId: identity?.userId,
    userName: identity?.userName ?? undefined,
  })
  const body = base64url(payload)
  const signature = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${signature}`
}
