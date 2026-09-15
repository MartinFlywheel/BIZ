'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { clientePorCuentaManyChat, esCodigoValido, patronExacto } from '@/lib/manychat'
import { createContentAction } from './content'
import type { ContentType } from '@/lib/types'

/**
 * Códigos de ManyChat que llegan sin pieza de contenido.
 *
 * El webhook identifica la pieza solo por el código de la URL. Si nadie creó
 * la pieza (pasó con H_06_08 y R_17_08), antes el chat se perdía; ahora se
 * registra sin CTA y el log queda marcado. Esta vista junta esos logs por
 * código para que el equipo cree la pieza y los chats pasen a contar para
 * ella.
 */

export interface CodigoSinPieza {
  codigo: string
  llamadas: number
  personas: number
  primera: string
  ultima: string
  /** Llamadas que no alcanzaron a registrarse (antes del arreglo): esperan el reproceso. */
  pendientes: number
}

async function assertAccesoCliente(clientId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')
  const { data: perfil } = await supabase
    .from('users')
    .select('user_type, role, client_id')
    .eq('id', user.id)
    .single()
  if (!perfil || perfil.user_type !== 'agency') throw new Error('No autorizado')
  if (perfil.role !== 'admin' && perfil.client_id !== clientId) throw new Error('No tienes acceso a este cliente')
  return supabase
}

interface FilaLog {
  event_type: string
  received_at: string
  processed: boolean | null
  ig: string | null
  url: string | null
  cuenta: string | null
}

function cuentaDeUrl(url: string | null): string | null {
  const m = (url ?? '').match(/manychat\.com\/([^/?#]+)\//i)
  return m ? m[1] : null
}

export async function getCodigosSinPieza(clientId: string): Promise<CodigoSinPieza[]> {
  const supabase = await assertAccesoCliente(clientId)
  // webhook_logs no es legible con la sesión (RLS, migración 077): se lee con
  // el cliente admin después de validar el acceso, y solo salen agregados.
  const admin = createAdminClient()

  const filas = await fetchAllRows<FilaLog>((from, to) =>
    admin
      .from('webhook_logs')
      .select('event_type, received_at, processed, ig:payload->>ig_username, url:payload->>live_chat_url, cuenta:payload->>cuenta_manychat')
      .eq('source', 'manychat')
      .like('event_type', 'piece:%')
      .or('error.like.No content piece%,error.like.Código sin pieza%')
      .order('received_at', { ascending: true })
      .range(from, to)
  )

  // A qué cliente pertenece cada cuenta de ManyChat (una o dos cuentas en
  // total, así que son pocas consultas).
  const clientePorCuenta = new Map<string, string | null>()
  const grupos = new Map<string, CodigoSinPieza & { gente: Set<string> }>()
  for (const f of filas) {
    const cuenta = f.cuenta || cuentaDeUrl(f.url)
    if (!cuenta) continue
    if (!clientePorCuenta.has(cuenta)) clientePorCuenta.set(cuenta, await clientePorCuentaManyChat(admin, cuenta))
    if (clientePorCuenta.get(cuenta) !== clientId) continue

    const codigo = f.event_type.slice('piece:'.length)
    const g = grupos.get(codigo) ?? {
      codigo, llamadas: 0, personas: 0, primera: f.received_at, ultima: f.received_at, pendientes: 0, gente: new Set<string>(),
    }
    g.llamadas++
    if (f.ig) g.gente.add(f.ig.toLowerCase())
    if (f.received_at < g.primera) g.primera = f.received_at
    if (f.received_at > g.ultima) g.ultima = f.received_at
    if (!f.processed) g.pendientes++
    grupos.set(codigo, g)
  }

  if (grupos.size === 0) return []

  // Si alguien ya creó la pieza, el código deja de aparecer: los logs viejos
  // quedan con su marca, pero ya no hay nada que hacer desde aquí.
  const { data: piezas } = await supabase
    .from('content_pieces')
    .select('keyword_trigger')
    .eq('client_id', clientId)
    .not('keyword_trigger', 'is', null)
  const existentes = new Set((piezas ?? []).map((p) => String(p.keyword_trigger).toLowerCase()))

  return [...grupos.values()]
    .filter((g) => !existentes.has(g.codigo.toLowerCase()))
    .map(({ gente, ...g }) => ({ ...g, personas: gente.size }))
    .sort((a, b) => b.ultima.localeCompare(a.ultima))
}

/**
 * Crea la pieza con ese código y le pasa los chats que ya se registraron sin
 * CTA. Reusa createContentAction (valida que el código no esté tomado por
 * otro cliente). Las llamadas que quedaron pendientes de antes del arreglo se
 * enlazan al correr /api/cron/reprocesar-manychat-sin-pieza.
 */
export async function crearPiezaParaCodigo(
  clientId: string,
  codigo: string,
  tipo: ContentType
): Promise<{ ok: true; enlazados: number } | { ok: false; error: string }> {
  try {
    const supabase = await assertAccesoCliente(clientId)
    if (!esCodigoValido(codigo)) {
      return { ok: false, error: 'Ese código no es válido: ManyChat mandó la variable sin reemplazar.' }
    }
    if (!['reel', 'story', 'post'].includes(tipo)) return { ok: false, error: 'Elige el tipo de pieza' }

    const form = new FormData()
    form.set('client_id', clientId)
    form.set('content_type', tipo)
    form.set('keyword_trigger', codigo)
    const creada = await createContentAction(form)
    if (!creada.success) return { ok: false, error: creada.error }

    const { data: pieza } = await supabase
      .from('content_pieces')
      .select('id')
      .eq('client_id', clientId)
      .ilike('keyword_trigger', patronExacto(codigo))
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!pieza) return { ok: true, enlazados: 0 }

    // Los chats registrados sin pieza guardaron el código en keyword_used, y
    // sus leads nuevos quedaron con first_touch_type "manychat:<código>".
    const { data: enlazadas, error: errorInter } = await supabase
      .from('interactions')
      .update({ content_id: pieza.id, updated_at: new Date().toISOString() })
      .eq('client_id', clientId)
      .is('content_id', null)
      .ilike('keyword_used', patronExacto(codigo))
      .select('id')
    if (errorInter) console.error(`[manychat-pendientes] no se enlazaron interacciones de ${codigo}: ${errorInter.message}`)

    const { error: errorLeads } = await supabase
      .from('leads')
      .update({ first_touch_content_id: pieza.id, content_id: pieza.id })
      .eq('client_id', clientId)
      .is('first_touch_content_id', null)
      .eq('first_touch_type', `manychat:${codigo}`)
    if (errorLeads) console.error(`[manychat-pendientes] no se enlazaron leads de ${codigo}: ${errorLeads.message}`)

    try { revalidatePath(`/clients/${clientId}`) } catch {}
    return { ok: true, enlazados: enlazadas?.length ?? 0 }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo crear la pieza' }
  }
}
