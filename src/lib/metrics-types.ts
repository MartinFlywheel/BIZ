// Plain constants/types shared between server actions and client components.
// Deliberately NOT a 'use server' file — those may only export async
// functions, so shared consts/types live here instead.

export const OVERRIDABLE_FIELDS = [
  'views_reels', 'views_historias', 'chats_abiertos', 'conversaciones',
  'agendas', 'shows', 'cierres', 'facturacion', 'cash_collected',
] as const

export type OverridableField = typeof OVERRIDABLE_FIELDS[number]
