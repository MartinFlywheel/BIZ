export const SOP_TAGS = ['Ventas', 'Marketing', 'Setting', 'Closing', 'Historias'] as const
export type SopTag = typeof SOP_TAGS[number]

// Reel CTA goal, shown on pipeline cards. Each option gets a distinct color
// (explicit map, not a hash) so visually similar goals never collide.
export const OBJETIVOS = ['Sígueme', 'Comenta', 'Comparte', 'Guarda', 'DM', 'Link en Bio'] as const

const OBJETIVO_PALETTE: Record<string, { text: string; bg: string; border: string; dot: string }> = {
  'Sígueme':     { text: 'text-violet-300',   bg: 'bg-violet-500/10',   border: 'border-violet-500/25', dot: 'bg-violet-400' },
  'Comenta':     { text: 'text-cyan-300',     bg: 'bg-cyan-500/10',     border: 'border-cyan-500/25',   dot: 'bg-cyan-400' },
  'Comparte':    { text: 'text-emerald-300',  bg: 'bg-emerald-500/10', border: 'border-emerald-500/25', dot: 'bg-emerald-400' },
  'Guarda':      { text: 'text-amber-300',    bg: 'bg-amber-500/10',   border: 'border-amber-500/25',   dot: 'bg-amber-400' },
  'DM':          { text: 'text-rose-300',     bg: 'bg-rose-500/10',    border: 'border-rose-500/25',    dot: 'bg-rose-400' },
  'Link en Bio': { text: 'text-fuchsia-300',  bg: 'bg-fuchsia-500/10', border: 'border-fuchsia-500/25', dot: 'bg-fuchsia-400' },
}

// Fallback for custom (user-typed) objectives not in the fixed list above.
const OBJETIVO_FALLBACK = { text: 'text-blue-300', bg: 'bg-blue-500/10', border: 'border-blue-500/25', dot: 'bg-blue-400' }

export function objectiveColor(objective: string) {
  return OBJETIVO_PALETTE[objective] ?? OBJETIVO_FALLBACK
}

export type UserType = 'agency' | 'client'

export type UserRole = 'admin' | 'sales_director' | 'closer' | 'setter' | 'editor' | 'client_owner'

export type ClientStatus = 'prospect' | 'onboarding' | 'active' | 'paused' | 'churned'

export type ContentType = 'reel' | 'story' | 'post' | 'live' | 'trial'

export type InteractionClassification = 'chat_abierto' | 'conversacion_real' | 'lead_calificado' | 'disqualified'

export type InteractionSource = 'manychat' | 'gohighlevel' | 'manual' | 'api'

export type LeadStage =
  | 'nuevo_contacto' | 'seguimiento' | 'conversando'
  | 'micro_vsl_enviado' | 'vsl_chat' | 'pitcheado'
  | 'calendly_enviado' | 'seguimiento_1' | 'seguimiento_2'
  | 'propuesta_enviada' | 'agendado' | 'no_calificado' | 'cierre'
  | 'new' | 'contacted' | 'agenda_set' | 'showed_up' | 'no_show'
  | 'closed_won' | 'closed_lost' | 'vsl_enviado' | 'cliente'

export interface PipelineStageConfig {
  id: string
  label: string
  color: string
}

export const LEAD_STAGES: PipelineStageConfig[] = [
  { id: 'nuevo_contacto', label: 'Nuevo Contacto', color: 'text-zinc-400' },
  { id: 'seguimiento', label: 'Seguimiento', color: 'text-blue-400' },
  { id: 'conversando', label: 'Conversando', color: 'text-violet-400' },
  { id: 'micro_vsl_enviado', label: 'Micro VSL Enviado', color: 'text-cyan-400' },
  { id: 'vsl_chat', label: 'VSL Chat', color: 'text-cyan-300' },
  { id: 'pitcheado', label: 'Pitcheado', color: 'text-orange-400' },
  { id: 'calendly_enviado', label: 'Calendly Enviado', color: 'text-indigo-400' },
  { id: 'seguimiento_1', label: 'Seguimiento 1', color: 'text-blue-300' },
  { id: 'seguimiento_2', label: 'Seguimiento 2', color: 'text-blue-200' },
  { id: 'propuesta_enviada', label: 'Propuesta Enviada', color: 'text-amber-400' },
  { id: 'agendado', label: 'Agendado', color: 'text-amber-300' },
  { id: 'no_calificado', label: 'No Calificado', color: 'text-red-400' },
  { id: 'cierre', label: 'Cierre', color: 'text-emerald-400' },
]

export const LEAD_AVATARS = ['Marca Personal', 'Editores', 'El Comoditizado', 'En Cero'] as const
export type LeadAvatar = typeof LEAD_AVATARS[number]

export const LEAD_EVENTS = [
  'Micro VSL Enviado',
  'VSL Chat',
  'Pitcheado',
  'Calendly Enviado',
  'Seguimiento 1',
  'Seguimiento 2',
  'Propuesta Enviada',
] as const
export type LeadEvent = typeof LEAD_EVENTS[number]

export type CallOutcome = 'completed' | 'no_show' | 'rescheduled' | 'cancelled'

export type CallSentiment = 'positive' | 'neutral' | 'negative'

// 'sales_direction' separa "quién dirige las ventas de este cliente" de "quién
// toma las llamadas" (closing). Hace falta porque el permiso vive en
// users.role —donde Martín y Fabián son ambos 'admin'— y por eso no sirve para
// decidir a quién se le asigna una tarea. Ver supabase/039.
export type Responsibility = 'content' | 'setting' | 'closing' | 'strategy' | 'sales_direction'

export type CampaignStatus = 'draft' | 'active' | 'completed'

export type MetricsSource = 'manual' | 'meta_api'

export type NotificationType = 'alert' | 'diagnosis' | 'assignment' | 'system'

export type NotificationSeverity = 'info' | 'warning' | 'critical'

export type IntegrationPlatform = 'instagram' | 'manychat' | 'gohighlevel' | 'funnelapp' | 'fathom'

export type IntegrationStatus = 'connected' | 'disconnected' | 'error' | 'pending_review'

export type BenchmarkComparison = 'gte' | 'lte'

export type OnboardingStatus = 'in_progress' | 'completed' | 'cancelled'

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

// =====================================================
// Database Row Types
// =====================================================

export interface User {
  id: string
  email: string
  full_name: string
  user_type: UserType
  role: UserRole
  client_id: string | null
  avatar_url: string | null
  is_active: boolean
  created_at: string
}

export interface Client {
  id: string
  name: string
  ig_handle: string
  ig_account_id: string | null
  ad_account_id: string | null
  industry: string | null
  status: ClientStatus
  monthly_fee: number | null
  calendly_token: string | null
  calendly_org_uri: string | null
  calendly_webhook_id: string | null
  custom_avatars: string[]
  pipeline_stages: PipelineStageConfig[] | null
  onboarded_at: string | null
  created_at: string
  updated_at: string
}

export interface TeamAssignment {
  id: string
  client_id: string
  user_id: string
  responsibility: Responsibility
  is_primary: boolean
  created_at: string
}

export interface Campaign {
  id: string
  client_id: string
  name: string
  start_date: string
  end_date: string | null
  goal: string | null
  status: CampaignStatus
  created_at: string
}

export interface ContentPiece {
  id: string
  client_id: string
  campaign_id: string | null
  content_type: ContentType
  ig_media_id: string | null
  ig_permalink: string | null
  ig_thumbnail_url: string | null
  caption: string | null
  keyword_trigger: string | null
  published_at: string | null
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
  reach: number
  hook: string | null
  avg_watch_time_seconds: number | null
  total_interactions: number
  story_expires_at: string | null
  metrics_source: MetricsSource
  metrics_updated_at: string | null
  created_at: string
  updated_at: string
}

export interface ContentNote {
  id: string
  content_id: string
  author_id: string
  note: string
  tags: string[]
  created_at: string
  updated_at: string
}

export interface Interaction {
  id: string
  client_id: string
  content_id: string | null
  campaign_id: string | null
  ig_user_id: string | null
  ig_username: string | null
  prospect_name: string | null
  classification: InteractionClassification
  source: InteractionSource
  manychat_subscriber_id: string | null
  keyword_used: string | null
  bot_triggered_at: string
  prospect_responded_at: string | null
  qualified_at: string | null
  prequalification_data: Record<string, unknown>
  promoted_to_lead: boolean
  created_at: string
  updated_at: string
}

export interface Lead {
  id: string
  client_id: string
  interaction_id: string | null
  content_id: string | null
  ig_username: string | null
  full_name: string | null
  phone: string | null
  email: string | null
  stage: string
  assigned_to: string | null
  lead_avatar: string | null
  events: string[]
  notes: string | null
  lost_reason: string | null
  first_touch_content_id: string | null
  first_touch_at: string | null
  first_touch_type: string | null
  conversion_touch_content_id: string | null
  conversion_touch_at: string | null
  conversion_touch_type: string | null
  contacted_at: string | null
  agenda_at: string | null
  call_at: string | null
  closed_at: string | null
  close_value: number | null
  days_to_close: number | null
  next_follow_up_date: string | null
  follow_up_count: number
  created_at: string
  updated_at: string
}

export type CallBucket = 'cerrada' | 'no_cerrada'

export interface SalesCall {
  id: string
  lead_id: string
  caller_id: string | null
  scheduled_at: string | null
  started_at: string | null
  ended_at: string | null
  duration_seconds: number | null
  outcome: CallOutcome | null
  fathom_recording_id: string | null
  fathom_call_url: string | null
  transcript: string | null
  ai_summary: string | null
  objections: Array<{ objection: string; response: string; resolved: boolean }>
  next_steps: string | null
  sentiment: CallSentiment | null
  bucket: CallBucket | null
  folder_id: string | null
  created_at: string
}

export interface CallFolder {
  id: string
  client_id: string
  parent_id: string | null
  bucket: CallBucket
  name: string
  created_at: string
}

export interface Benchmark {
  id: string
  client_id: string | null
  metric_key: string
  threshold_value: number
  comparison: BenchmarkComparison
  responsible_area: Responsibility | null
  diagnosis_message: string | null
  created_at: string
}

export interface Notification {
  id: string
  user_id: string
  title: string
  body: string | null
  type: NotificationType
  severity: NotificationSeverity
  reference_type: string | null
  reference_id: string | null
  is_read: boolean
  created_at: string
}

export interface Integration {
  id: string
  client_id: string | null
  platform: IntegrationPlatform
  access_token: string | null
  refresh_token: string | null
  token_expires_at: string | null
  config: Record<string, unknown>
  status: IntegrationStatus
  last_sync_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface SyncLog {
  id: string
  integration_id: string
  sync_type: string
  status: 'started' | 'completed' | 'failed'
  records_processed: number
  error: string | null
  started_at: string
  completed_at: string | null
}

// =====================================================
// Dashboard Metrics
// =====================================================

export interface DashboardMetrics {
  chats_abiertos: number
  conversaciones_reales: number
  agendas: number
  show_ups: number
  cierres: number
  facturacion: number
  cash_collected: number
  total_views: number
  tasa_respuesta: number
  tasa_agendamiento: number
  tasa_show_up: number
  tasa_cierre: number
}

export interface BenchmarkAlert {
  metric_key: string
  current_value: number
  threshold_value: number
  comparison: BenchmarkComparison
  is_failing: boolean
  diagnosis_message: string | null
  responsible_area: Responsibility | null
}

// =====================================================
// Funnel Engine (computed by lib/actions/funnel.ts)
// =====================================================

export interface FunnelStage {
  id: string
  label: string
  value: number           // raw count
  rate: number            // % retention from previous stage
  benchmark_min: number   // below this = critical
  benchmark_max: number   // ideal upper range
  status: 'healthy' | 'warning' | 'critical'
  is_bottleneck: boolean  // true only for the single worst drop
}

export interface FunnelResult {
  stages: FunnelStage[]
  bottleneck: string | null           // stage id with worst drop
  bottleneck_drop: number             // % points lost at bottleneck
  period: { start: string; end: string; type: string }
  raw: {
    views_reels: number
    views_historias: number
    chats_abiertos: number
    conversaciones: number
    agendas: number
    shows: number
    cierres: number
    facturacion: number
    cash_collected: number
  }
}

export interface ClientHealthAlert {
  client_id: string
  client_name: string
  ig_handle: string
  alerts: Array<{
    stage_id: string
    stage_label: string
    current_rate: number
    benchmark_min: number
    deficit: number
  }>
  worst_stage: string | null
  status: 'healthy' | 'critical'
}

export interface ClientMetrics {
  id: string
  client_id: string
  period_start: string
  period_end: string
  period_type: 'daily' | 'weekly' | 'monthly'
  views_reels: number
  views_historias: number
  chats_abiertos: number
  conversaciones: number
  agendas: number
  shows: number
  cierres: number
  facturacion: number
  cash_collected: number
  notes: string | null
  created_at: string
  updated_at: string
}

export interface SopAttachment {
  id: string
  type: 'loom' | 'google_doc' | 'google_drive' | 'miro' | 'youtube' | 'vimeo' | 'notion' | 'link'
  url: string
  title: string
  embed_url?: string
}

export interface Sop {
  id: string
  title: string
  content: string
  category: string | null
  tags: string[]
  attachments: SopAttachment[]
  version: number
  created_at: string
  updated_at: string
}

export interface OnboardingStep {
  title: string
  description?: string
  sop_id?: string | null
}

export interface OnboardingTemplate {
  id: string
  name: string
  steps: OnboardingStep[]
  created_at: string
  updated_at: string
}

// =====================================================
// Content-Level Metrics (per-piece attribution)
// =====================================================

export interface ContentMetrics {
  id: string
  content_id: string
  client_id: string
  views: number
  chats_nuevos: number
  conversaciones_nuevas: number
  agendas: number
  shows: number
  cierres: number
  ticket: number
  aov: number
  cash_collected: number
  manychat_label: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

// =====================================================
// Competitors Module
// =====================================================

export interface Competitor {
  id: string
  client_id: string
  name: string
  ig_handle: string | null
  ig_profile_url: string | null
  ig_account_id: string | null
  followers: number | null
  analisis_estrategico: string | null
  oferta: string | null
  avatar_target: string | null
  conclusion: string | null
  created_at: string
  updated_at: string
}

export interface CompetitorReel {
  id: string
  competitor_id: string
  ig_media_id: string | null
  video_url: string | null
  thumbnail_url: string | null
  caption: string | null
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
  published_at: string | null
  synced_at: string
}

export type MessageType = 'text' | 'media' | 'story_reply' | 'reaction' | 'other'



export type MessageStatus = 'unread' | 'read' | 'promoted' | 'archived'

export type MessageDirection = 'inbound' | 'outbound'

export interface IncomingMessage {
  id: string
  sender_ig_id: string
  sender_ig_username: string | null
  recipient_ig_id: string | null
  message_text: string | null
  message_mid: string | null
  media_url: string | null
  message_type: MessageType
  status: MessageStatus
  client_id: string | null
  webhook_log_id: string | null
  promoted_to_interaction_id: string | null
  direction: MessageDirection
  lead_id: string | null
  sent_by: string | null
  received_at: string
  read_at: string | null
  created_at: string
}

// =====================================================
// Product & Delivery Module
// =====================================================

export type ProductRiskLevel = 'green' | 'yellow' | 'red'

export interface ProgramStudent {
  id: string
  client_id: string // Relacionado al Cliente de la Agencia (ej. Mane)
  lead_id: string | null // Relacionado al Lead del CRM si existía antes
  full_name: string
  phone: string
  email: string
  start_date: string
  current_day: number
  risk_level: ProductRiskLevel
  created_at: string
  updated_at: string
}

export interface OnboardingData {
  id: string
  student_id: string
  form_responses: Record<string, unknown>
  photos: string[]
  submitted_at: string
}

export interface FollowUp {
  id: string
  student_id: string
  day_number: number
  sent_at: string | null
  status: 'pending' | 'sent' | 'failed'
  notes: string | null
}

export type AiMessageStatus = 'pending' | 'approved' | 'rejected' | 'sent'

export interface AiMessageQueue {
  id: string
  student_id: string
  follow_up_id: string | null
  message_text: string | null
  audio_url: string | null
  status: AiMessageStatus
  generated_at: string
  reviewed_at: string | null
}

// ── Tareas del equipo (supabase/036-team-tasks.sql) ───────────────────────────
// Espejo de una base de datos de Notion. Notion es la fuente de verdad; el
// CRM sólo refleja y devuelve el estado — ver src/lib/services/notion.ts.

export type TeamTaskStatus = 'pendiente' | 'en_progreso' | 'hecha'
export type TeamTaskPriority = 'baja' | 'media' | 'alta'

export interface TeamTask {
  id: string
  client_id: string
  notion_page_id: string
  notion_url: string | null
  title: string
  status: TeamTaskStatus
  /** El estado tal cual figura en Notion ("Listo", "En curso"…). */
  status_raw: string | null
  priority: TeamTaskPriority | null
  due_date: string | null
  /** Fin del rango de Notion. NULL cuando la tarea ocupa un solo día. */
  end_date: string | null
  /**
   * true cuando la fila describe una ETAPA del lanzamiento ("PERSONALIDAD",
   * "EXPERTIZ") y no una tarea que se completa. No se marca, no vence, y las
   * tareas cuyas fechas caen dentro de su rango le pertenecen. Ver supabase/041.
   */
  is_stage: boolean
  /** Responsable según Notion, aunque no matchee con ningún usuario del CRM. */
  assignee_name: string | null
  assigned_to: string | null
  /** Agrupador de Notion: fase del lanzamiento, categoría, semana… */
  group_name: string | null
  completed_at: string | null
  completion_note: string | null
  notion_last_edited: string | null
  synced_at: string | null
  created_at: string
  updated_at: string
}

export const TASK_STATUS_LABEL: Record<TeamTaskStatus, string> = {
  pendiente: 'Pendiente',
  en_progreso: 'En progreso',
  hecha: 'Hecha',
}

export const TASK_PRIORITY_LABEL: Record<TeamTaskPriority, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
}
