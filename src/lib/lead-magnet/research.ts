/**
 * Research lead magnet de Carol Soto Coloma: tipos y reglas puras.
 *
 * Las respuestas del formulario viven en la base Neon de la landing
 * (carol-soto-landing, tabla `respuestas`), no en Supabase. Se decidió leerla
 * directo desde el CRM en vez de duplicar los registros: un solo origen de
 * datos, la landing sigue funcionando igual y el panel viejo (equipo.html)
 * queda como respaldo mientras se comprueba que esta pestaña lo reemplaza.
 *
 * Este módulo no toca la red: aquí van los tipos, el semáforo por ingreso y
 * las etiquetas de las 17 preguntas. Las consultas están en
 * `src/lib/actions/lead-magnet.ts`.
 */

export type Semaforo = 'verde' | 'amarillo' | 'rojo' | 'sin_dato'

export type SeguimientoLead = 'pendiente' | 'enviado' | 'contactado' | 'agendado' | 'descartado'

export const SEGUIMIENTOS: { value: SeguimientoLead; label: string }[] = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'enviado', label: 'Enviado' },
  { value: 'contactado', label: 'Contactado' },
  { value: 'agendado', label: 'Agendado' },
  { value: 'descartado', label: 'Descartado' },
]

/**
 * Cortes del semáforo. Un rango que no aparezca aquí (o `null`) cae en
 * `sin_dato`, para que un cambio de opciones en el formulario no deje a nadie
 * mal clasificado en silencio.
 *
 * Corte pendiente de confirmar con Martín: "$300 a $600" quedó en rojo porque
 * dijo "menos de 300 o 500"; si decide que va en amarillo, basta con moverlo.
 */
export const RANGOS_INGRESO: { rango: string; semaforo: Semaforo; orden: number }[] = [
  { rango: '$0 a $300', semaforo: 'rojo', orden: 0 },
  { rango: '$300 a $600', semaforo: 'rojo', orden: 1 },
  { rango: '$600 a $900', semaforo: 'amarillo', orden: 2 },
  { rango: '$900 a $1.200', semaforo: 'amarillo', orden: 3 },
  { rango: '$1.200 a $1.500', semaforo: 'verde', orden: 4 },
  { rango: 'Más de $1.500', semaforo: 'verde', orden: 5 },
]

export function semaforoPorIngreso(ingreso: string | null | undefined): Semaforo {
  if (!ingreso) return 'sin_dato'
  const limpio = ingreso.trim()
  return RANGOS_INGRESO.find((r) => r.rango === limpio)?.semaforo ?? 'sin_dato'
}

export function ordenIngreso(ingreso: string | null | undefined): number {
  if (!ingreso) return -1
  return RANGOS_INGRESO.find((r) => r.rango === ingreso.trim())?.orden ?? -1
}

export const SEMAFORO_LABEL: Record<Semaforo, string> = {
  verde: 'Verde',
  amarillo: 'Amarillo',
  rojo: 'Rojo',
  sin_dato: 'Sin dato',
}

/** Índice 16 es el WhatsApp: ya va en su propia columna, no se muestra dos veces. */
export const ETIQUETAS_PREGUNTAS = [
  'Qué te tiene incómodo contigo',
  'Situación que se repite aunque cambie todo',
  'Lo último que empezaste y dejaste; qué te dijiste',
  'Cuándo te diste cuenta de que era un problema',
  'Qué has probado',
  'En qué momento dejó de funcionar y por qué',
  'Primer pensamiento sobre ti cuando algo sale mal',
  'Algo que sí sostuviste y qué fue distinto',
  'Qué le preguntarías a alguien que ya salió',
  'Dónde estarías si esto no te frenara',
  'Qué debería incluir un programa',
  'Dónde se nota más el problema',
  'Frase con la que se identifica',
  'Edad',
  'País y ocupación',
  'Ingreso mensual (USD)',
  'WhatsApp',
]

export interface PatronLead {
  numero: number
  nombre: string
}

/** Lo que devuelve la lista: sin el texto completo de respuestas ni del plan. */
export interface LeadResearch {
  id: string
  creado: string
  estado: 'recibido' | 'listo' | 'error' | string
  whatsapp: string | null
  pais: string | null
  ocupacion: string | null
  edad: string | null
  ingreso: string | null
  semaforo: Semaforo
  patron: PatronLead | null
  resumen_equipo: string | null
  riesgo: boolean
  seguimiento: SeguimientoLead
  notas: string | null
  error: string | null
  /** Usuario de Instagram que viajó en el enlace de ManyChat (?ig=). */
  ig_username: string | null
  /** Vínculo manual guardado en Neon. */
  lead_id: string | null
  /** Lead del CRM con el que se cruzó, si se encontró. */
  lead: { id: string; full_name: string | null; ig_username: string | null } | null
  vinculo: 'manual' | 'instagram' | 'telefono' | null
}

export interface PlanLead {
  genero?: 'f' | 'm' | 'n'
  patron: PatronLead
  espejo: string[]
  lo_que_haces_mal: string
  lo_que_te_cuesta: string
  por_que_no_funciono: string
  si_sigues_igual: string
  esto_se_resuelve: string
  cierre: string
  riesgo: boolean
  resumen_equipo: string
}

export interface LeadResearchDetalle extends LeadResearch {
  plan: PlanLead | null
  respuestas: unknown[]
}

/** Enlace de WhatsApp: solo dígitos, como hace el panel de la landing. */
export function enlaceWhatsapp(numero: string | null | undefined): string | null {
  const digitos = String(numero ?? '').replace(/\D/g, '')
  return digitos ? `https://wa.me/${digitos}` : null
}

/**
 * La pestaña solo existe para el cliente de Carol. Se resuelve por id si
 * `LEAD_MAGNET_CLIENT_ID` está definida (lo más robusto) y, si no, por nombre,
 * para que funcione sin configurar nada más que la conexión.
 */
export function clienteTieneLeadMagnet(client: { id: string; name: string }): boolean {
  const idConfigurado = process.env.LEAD_MAGNET_CLIENT_ID
  if (idConfigurado) return client.id === idConfigurado
  const nombre = client.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  return nombre.includes('carol soto')
}
