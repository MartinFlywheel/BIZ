import { NextResponse } from 'next/server'
import {
  conAgente, respuestaError, telefonoDelCuerpo,
  buscarLeadPorTelefono, leerLead, resumenLead,
  type AdminClient,
} from '@/lib/agent-api'

const COLUMNA_INEXISTENTE = '42703'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Preguntas que la landing manda hoy, con la etiqueta que se lee en el CRM. */
const PREGUNTAS: Array<{ clave: string; rotulo: string }> = [
  { clave: 'zonas', rotulo: 'Zonas' },
  { clave: 'ocupacion', rotulo: 'Rutina' },
  { clave: 'probado', rotulo: 'Ya probó' },
  { clave: 'ingresos', rotulo: 'Ingresos al mes' },
  // La pregunta anterior. Se sigue aceptando para no perder lo que llegue de
  // una pestaña que quedó abierta con la versión vieja de la landing.
  { clave: 'inversion', rotulo: 'Puede invertir' },
  { clave: 'diagnostico', rotulo: 'Diagnóstico' },
]

const MARCA_INICIO = '[Análisis facial]'
const MARCA_FIN = '[/Análisis facial]'

function limpiar(valor: unknown): string[] {
  const bruto = Array.isArray(valor) ? valor : [valor]
  return bruto
    .filter((v): v is string => typeof v === 'string')
    // Sin las marcas del bloque: un valor que las traiga haría que el reemplazo
    // de las notas corte en un lugar equivocado.
    .map((v) => v.split(MARCA_INICIO).join('').split(MARCA_FIN).join('').trim().slice(0, 160))
    .filter(Boolean)
    .slice(0, 12)
}

/**
 * Se queda solo con las preguntas conocidas. El cuerpo llega de un navegador
 * a través de la función de la landing, así que nada que no esté en la lista
 * termina guardado.
 */
function limpiarQuiz(body: Record<string, unknown>): Record<string, string[]> | null {
  const bruto = (body.quiz ?? body.respuestas ?? body) as Record<string, unknown>
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null

  const salida: Record<string, string[]> = {}
  for (const { clave } of PREGUNTAS) {
    const v = limpiar(bruto[clave])
    if (v.length > 0) salida[clave] = v
  }
  return Object.keys(salida).length > 0 ? salida : null
}

/** El bloque que ve el setter en la columna de notas, sin abrir nada más. */
function resumenLegible(quiz: Record<string, string[]>): string {
  const lineas = [MARCA_INICIO]
  for (const { clave, rotulo } of PREGUNTAS) {
    const v = quiz[clave]
    if (v?.length) lineas.push(`${rotulo}: ${v.join(', ')}`)
  }
  lineas.push(MARCA_FIN)
  return lineas.join('\n')
}

/**
 * Reemplaza solo el bloque del análisis y deja intacto todo lo que el setter
 * haya escrito antes o después. Por eso el bloque lleva marca de inicio y de
 * fin: sin la de fin no hay forma de saber dónde termina, y una segunda
 * escritura borraría las notas hechas a mano.
 *
 * Si falta alguna de las dos marcas (alguien editó el bloque a mano), no se
 * toca nada de lo existente y el bloque nuevo se agrega arriba.
 */
function notasConAnalisis(notasActuales: string | null, bloque: string): string {
  const actuales = notasActuales ?? ''
  const inicio = actuales.indexOf(MARCA_INICIO)
  const fin = inicio >= 0 ? actuales.indexOf(MARCA_FIN, inicio) : -1

  if (inicio >= 0 && fin >= 0) {
    return actuales.slice(0, inicio) + bloque + actuales.slice(fin + MARCA_FIN.length)
  }

  const resto = actuales.trim()
  return resto ? `${bloque}\n\n${resto}` : bloque
}

/**
 * Cuánto tiempo puede rehacerse el análisis. Pasado esto queda fijo.
 *
 * La landing solo autoriza a guardar a quien envió el formulario con ese
 * teléfono, pero enviar el formulario no prueba que el teléfono sea suyo.
 * Sin este plazo, alguien podría poner el número de una clienta antigua y
 * reescribirle el análisis que el setter ya usó para calificarla.
 */
const VENTANA_REHACER_MS = 6 * 60 * 60 * 1000

/**
 * true si el lead ya tiene un análisis guardado hace más de la ventana.
 * Si la migración 069 no se corrió no hay cómo saberlo y se deja pasar: es
 * el mismo comportamiento que había antes de esta regla.
 */
async function analisisYaFijo(supabase: AdminClient, leadId: string): Promise<boolean> {
  const { data, error } = await supabase.from('leads').select('quiz').eq('id', leadId).maybeSingle()
  if (error) {
    if (error.code === COLUMNA_INEXISTENTE) return false
    throw error
  }
  const guardadoEn = (data as { quiz: { guardado_en?: string } | null } | null)?.quiz?.guardado_en
  if (!guardadoEn) return false
  const cuando = Date.parse(guardadoEn)
  return Number.isFinite(cuando) && Date.now() - cuando > VENTANA_REHACER_MS
}

/** Escribe la columna `quiz` solo si la migración 069 ya se corrió. */
async function guardarQuiz(supabase: AdminClient, leadId: string, respuestas: Record<string, string[]>) {
  const quiz = { ...respuestas, guardado_en: new Date().toISOString() }
  const { error } = await supabase.from('leads').update({ quiz }).eq('id', leadId)
  if (!error) return true
  if (error.code === COLUMNA_INEXISTENTE) return false
  throw error
}

// POST /api/agent/v1/leads/quiz
// { phone, quiz: { zonas: [...], ocupacion: [...], probado: [...],
//                  ingresos: [...], diagnostico: "..." } }
//
// Guarda lo que la persona respondió en la precalificación de la landing.
// El detalle queda en la columna `quiz` y el resumen legible en `notes`, que
// es lo que el setter ve en la tabla antes de contestarle.
//
// El lead tiene que existir: lo crea la misma landing con POST
// /api/agent/v1/leads cuando se envía el formulario.
export async function POST(request: Request) {
  return conAgente(request, 'quiz', async ({ supabase, agente, body }) => {
    const { e164 } = telefonoDelCuerpo(body)
    if (!e164) return respuestaError('Falta el teléfono o no tiene un formato reconocible', 400)

    const quiz = limpiarQuiz(body)
    if (!quiz) {
      return respuestaError('No llegó ninguna respuesta reconocible', 400, {
        preguntas_validas: PREGUNTAS.map((p) => p.clave),
      })
    }

    const lead = await buscarLeadPorTelefono(supabase, agente.clientId, e164)
    if (!lead) return respuestaError('No existe un lead con ese teléfono. Créalo primero con POST /api/agent/v1/leads', 404)

    if (await analisisYaFijo(supabase, lead.id)) {
      return respuestaError('Este lead ya tiene un análisis guardado y ya no se puede reemplazar', 409)
    }

    const guardado = await guardarQuiz(supabase, lead.id, quiz)

    // Las notas son el camino que siempre funciona, con migración o sin ella.
    const { data: fila } = await supabase.from('leads').select('notes').eq('id', lead.id).maybeSingle()
    const { error } = await supabase
      .from('leads')
      .update({
        notes: notasConAnalisis((fila as { notes: string | null } | null)?.notes ?? null, resumenLegible(quiz)),
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead.id)
    if (error) throw error

    const actualizado = (await leerLead(supabase, lead.id)) ?? lead
    return NextResponse.json({
      ok: true,
      detalle_guardado: guardado,
      lead: await resumenLead(supabase, actualizado),
    })
  })
}
