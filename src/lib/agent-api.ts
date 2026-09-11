// Lógica compartida de /api/agent/v1/*: la puerta por la que un sistema
// externo (el agente de WhatsApp) crea y consulta leads del CRM.
//
// Decisiones:
// - La persona se identifica por teléfono normalizado (leads.phone_e164,
//   migración 059). Mientras esa migración no se corra, se busca contra
//   leads.phone con las variantes habituales (código 42703).
// - El agente solo ve lo justo para decidir cómo responder: nombre, etapa,
//   etiquetas, si tiene setter y si tiene cita. Nunca notas ni correo.
// - Cada llamada queda en webhook_logs con source 'agent', igual que los
//   webhooks, para poder auditar qué hizo el agente y cuándo.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { autenticarAgente, type AgenteAutenticado } from '@/lib/api-auth'
import { normalizarTelefono, variantesTelefonoCrudo } from '@/lib/phone'
import { LEAD_STAGES, LEAD_EVENTS, type PipelineStageConfig } from '@/lib/types'

export type AdminClient = ReturnType<typeof createAdminClient>

const COLUMNA_INEXISTENTE = '42703'

export interface LeadFila {
  id: string
  client_id: string
  full_name: string | null
  ig_username: string | null
  phone: string | null
  email: string | null
  stage: string
  assigned_to: string | null
  events: string[] | null
  interaction_id: string | null
  created_at: string
}

const COLUMNAS_LEAD = 'id, client_id, full_name, ig_username, phone, email, stage, assigned_to, events, interaction_id, created_at'

// ── Respuestas ───────────────────────────────────────────────────────────────

export function respuestaError(mensaje: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: mensaje, ...(extra ?? {}) }, { status })
}

// ── Auditoría ────────────────────────────────────────────────────────────────

export async function registrarLlamada(
  supabase: AdminClient,
  accion: string,
  agente: AgenteAutenticado | null,
  payload: unknown,
  error: string | null
) {
  try {
    await supabase.from('webhook_logs').insert({
      source: 'agent',
      event_type: `agent:${accion}`,
      payload: { client_id: agente?.clientId ?? null, key_id: agente?.keyId ?? null, body: payload ?? null },
      processed: !error,
      error,
    })
  } catch (e) {
    console.error('[agent-api] no se pudo registrar la llamada:', e)
  }
}

// ── Límite de llamadas por llave ─────────────────────────────────────────────

/** Llamadas por minuto que acepta una misma llave antes de responder 429. */
const LIMITE_POR_MINUTO = 120

/**
 * Frena el abuso si una llave se filtra. Se cuenta sobre webhook_logs, que
 * ya guarda cada llamada con su key_id, así que no hace falta otra tabla.
 * Si el conteo falla (tabla vieja, columna ausente), se deja pasar: el
 * límite es una red de seguridad, no puede tumbar la API.
 */
async function excedeLimite(supabase: AdminClient, keyId: string): Promise<boolean> {
  try {
    const desde = new Date(Date.now() - 60_000).toISOString()
    const { count, error } = await supabase
      .from('webhook_logs')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'agent')
      .eq('payload->>key_id', keyId)
      .gte('received_at', desde)
    if (error) return false
    return (count ?? 0) >= LIMITE_POR_MINUTO
  } catch {
    return false
  }
}

// ── Envoltorio común de cada ruta ────────────────────────────────────────────

interface Contexto {
  supabase: AdminClient
  agente: AgenteAutenticado
  body: Record<string, unknown>
}

/**
 * Autentica, lee el cuerpo (o la query en GET), ejecuta el handler y deja
 * registro. Cualquier excepción termina en 500 con el mensaje registrado,
 * nunca en una respuesta vacía.
 */
export async function conAgente(
  request: Request,
  accion: string,
  handler: (ctx: Contexto) => Promise<NextResponse>
): Promise<NextResponse> {
  const supabase = createAdminClient()
  const auth = await autenticarAgente(supabase, request)
  if (auth.error) return auth.error

  if (await excedeLimite(supabase, auth.agente.keyId)) {
    await registrarLlamada(supabase, accion, auth.agente, null, 'Límite de llamadas por minuto excedido')
    return respuestaError('Demasiadas llamadas. Espera un minuto.', 429)
  }

  let body: Record<string, unknown> = {}
  if (request.method === 'GET') {
    body = Object.fromEntries(new URL(request.url).searchParams.entries())
  } else {
    try {
      const texto = await request.text()
      body = texto ? (JSON.parse(texto) as Record<string, unknown>) : {}
    } catch {
      await registrarLlamada(supabase, accion, auth.agente, null, 'JSON inválido')
      return respuestaError('El cuerpo no es JSON válido', 400)
    }
  }

  try {
    const res = await handler({ supabase, agente: auth.agente, body })
    await registrarLlamada(supabase, accion, auth.agente, body, res.status >= 400 ? `HTTP ${res.status}` : null)
    return res
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e)
    console.error(`[agent-api] ${accion} falló:`, e)
    await registrarLlamada(supabase, accion, auth.agente, body, mensaje)
    return respuestaError('Error interno', 500)
  }
}

// ── Lectura de campos del cuerpo ─────────────────────────────────────────────

export function texto(body: Record<string, unknown>, ...claves: string[]): string | null {
  for (const k of claves) {
    const v = body[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return null
}

export function telefonoDelCuerpo(body: Record<string, unknown>): { e164: string | null; crudo: string | null } {
  const crudo = texto(body, 'phone', 'telefono', 'phone_number', 'whatsapp')
  return { e164: normalizarTelefono(crudo), crudo }
}

export function limpiarInstagram(v: string | null): string | null {
  if (!v) return null
  return v.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, '').trim().toLowerCase() || null
}

// ── Búsqueda ─────────────────────────────────────────────────────────────────

export async function buscarLeadPorTelefono(supabase: AdminClient, clientId: string, e164: string): Promise<LeadFila | null> {
  const { data, error } = await supabase
    .from('leads')
    .select(COLUMNAS_LEAD)
    .eq('client_id', clientId)
    .eq('phone_e164', e164)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!error) return (data as LeadFila | null) ?? null

  // Migración 059 sin correr: se busca contra el teléfono crudo.
  if (error.code === COLUMNA_INEXISTENTE) {
    const { data: fallback } = await supabase
      .from('leads')
      .select(COLUMNAS_LEAD)
      .eq('client_id', clientId)
      .in('phone', variantesTelefonoCrudo(e164))
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    return (fallback as LeadFila | null) ?? null
  }

  throw error
}

export async function buscarLeadPorInstagram(supabase: AdminClient, clientId: string, ig: string): Promise<LeadFila | null> {
  const { data, error } = await supabase
    .from('leads')
    .select(COLUMNAS_LEAD)
    .eq('client_id', clientId)
    .ilike('ig_username', ig)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as LeadFila | null) ?? null
}

export async function leerLead(supabase: AdminClient, leadId: string): Promise<LeadFila | null> {
  const { data, error } = await supabase.from('leads').select(COLUMNAS_LEAD).eq('id', leadId).maybeSingle()
  if (error) throw error
  return (data as LeadFila | null) ?? null
}

// ── Etapas y etiquetas ───────────────────────────────────────────────────────

export async function etapasDelCliente(supabase: AdminClient, clientId: string): Promise<PipelineStageConfig[]> {
  const { data } = await supabase.from('clients').select('pipeline_stages').eq('id', clientId).maybeSingle()
  const etapas = (data?.pipeline_stages ?? null) as PipelineStageConfig[] | null
  return etapas && etapas.length > 0 ? etapas : LEAD_STAGES
}

/**
 * Etapas que el agente puede poner. Quedan fuera las que tienen efectos
 * que el agente no puede completar: "agendado" la pone sola la lectura de
 * Calendly (y crea la fila de agenda), y "cierre" la decide el closer
 * después de la llamada.
 */
const ETAPAS_AGENTE = new Set([
  'nuevo_contacto', 'seguimiento', 'conversando', 'micro_vsl_enviado', 'vsl_chat',
  'pitcheado', 'calendly_enviado', 'seguimiento_1', 'seguimiento_2',
  'propuesta_enviada', 'no_calificado',
])

export function etapasPermitidasAlAgente(etapas: PipelineStageConfig[]): PipelineStageConfig[] {
  return etapas.filter((e) => ETAPAS_AGENTE.has(e.id))
}

/** Acepta el id exacto o el nombre visible de la etapa, sin distinguir mayúsculas. */
export function resolverEtapa(etapas: PipelineStageConfig[], valor: string): PipelineStageConfig | null {
  const v = valor.trim().toLowerCase()
  return etapas.find((e) => e.id.toLowerCase() === v) ?? etapas.find((e) => e.label.toLowerCase() === v) ?? null
}

/** Solo el primer nombre: el agente puede decírselo al contacto y no conviene exponer el apellido. */
export function primerNombre(nombre: string | null | undefined): string | null {
  if (!nombre) return null
  return nombre.trim().split(/\s+/)[0] || null
}

/** El objeto referral del anuncio, si vino. Acepta objeto o texto. */
export function referralDelCuerpo(body: Record<string, unknown>): Record<string, unknown> | null {
  const r = body.referral ?? body.anuncio
  if (r && typeof r === 'object' && !Array.isArray(r)) return r as Record<string, unknown>
  if (typeof r === 'string' && r.trim()) return { texto: r.trim() }
  return null
}

/** Acepta la etiqueta tal cual o sin distinguir mayúsculas; devuelve la forma canónica. */
export function resolverEtiqueta(valor: string): string | null {
  const v = valor.trim().toLowerCase()
  return LEAD_EVENTS.find((e) => e.toLowerCase() === v) ?? null
}

// ── Resumen que ve el agente ─────────────────────────────────────────────────

export interface ResumenLead {
  id: string
  nombre: string | null
  telefono: string | null
  instagram: string | null
  etapa: string
  etapa_nombre: string
  etiquetas: string[]
  setter: string | null
  agenda: { fecha: string; estado: string | null } | null
  creado_en: string
}

export async function resumenLead(supabase: AdminClient, lead: LeadFila): Promise<ResumenLead> {
  const [etapas, setter, agenda] = await Promise.all([
    etapasDelCliente(supabase, lead.client_id),
    lead.assigned_to
      ? supabase.from('users').select('full_name').eq('id', lead.assigned_to).maybeSingle().then((r) => primerNombre(r.data?.full_name))
      : Promise.resolve(null),
    proximaAgenda(supabase, lead.id),
  ])
  const etapa = etapas.find((e) => e.id === lead.stage)
  return {
    id: lead.id,
    nombre: lead.full_name,
    telefono: normalizarTelefono(lead.phone) ?? lead.phone,
    instagram: lead.ig_username,
    etapa: lead.stage,
    etapa_nombre: etapa?.label ?? lead.stage,
    etiquetas: lead.events ?? [],
    setter,
    agenda,
    creado_en: lead.created_at,
  }
}

async function proximaAgenda(supabase: AdminClient, leadId: string): Promise<ResumenLead['agenda']> {
  try {
    const { data, error } = await supabase
      .from('agenda_records')
      .select('hora_agenda, fecha_agenda, estado, cancelada_at')
      .eq('lead_id', leadId)
      .order('hora_agenda', { ascending: false, nullsFirst: false })
      .limit(5)
    if (error || !data) return null
    const vivas = data.filter((a) => !a.cancelada_at)
    if (vivas.length === 0) return null
    const ahora = Date.now()
    const futuras = vivas.filter((a) => a.hora_agenda && new Date(a.hora_agenda).getTime() >= ahora)
    const elegida = futuras.length > 0 ? futuras[futuras.length - 1] : vivas[0]
    const fecha = elegida.hora_agenda ?? elegida.fecha_agenda
    return fecha ? { fecha, estado: elegida.estado ?? null } : null
  } catch {
    return null
  }
}
