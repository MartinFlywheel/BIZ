import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarInstagram } from '@/lib/services/calendly-event'

/**
 * El lead de un cliente con ese usuario de Instagram, si ya existe.
 *
 * Un Instagram es una persona: dos leads con el mismo @ terminan repartidos
 * entre dos setters, con la agenda en uno y la conversación en otro (ver
 * supabase/079 y 081). Toda vía que crea leads pasa por aquí antes de
 * insertar, y la 081 lo respalda con un índice único sobre la misma
 * normalización: minúsculas, sin espacios y sin "@".
 *
 * ilike con "_" y "%" escapados: son comodines, y "ana_perez" encontraba
 * también a "ana.perez". Se prueba además con "@" delante porque unos pocos
 * leads antiguos quedaron guardados así.
 *
 * A propósito sin 'use server': es un chequeo interno, no un endpoint.
 */
export async function leadPorInstagram(
  supabase: SupabaseClient,
  clientId: string,
  instagram: string | null | undefined
): Promise<{ id: string; assigned_to: string | null } | null> {
  const ig = normalizarInstagram(instagram)
  if (!ig) return null
  const patron = ig.replace(/[\\%_]/g, (c) => `\\${c}`)

  for (const valor of [patron, `@${patron}`]) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, assigned_to')
      .eq('client_id', clientId)
      .ilike('ig_username', valor)
      .order('created_at', { ascending: true })
      .limit(1)
    if (error) throw error
    if (data?.[0]) return data[0] as { id: string; assigned_to: string | null }
  }
  return null
}

/** 23505: el insert chocó con un índice único (teléfono de la 061 o Instagram de la 081). */
export function esDuplicado(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505'
}
