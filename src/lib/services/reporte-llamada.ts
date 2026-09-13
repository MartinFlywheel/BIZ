import { createAdminClient } from '@/lib/supabase/admin'

/**
 * El borrador del reporte de llamada, armado desde el resumen de Fathom.
 *
 * Lo que se escribe desde cero no se hace; lo que se aprueba, sí. Por eso el
 * sistema llena objeción, situación actual, dolores y preguntas no resueltas
 * apenas llega la grabación, y la dirección de ventas solo corrige y aprueba.
 *
 * Dos caminos:
 * - Con OPENAI_API_KEY, un modelo lee el resumen y redacta cada campo.
 * - Sin la clave, se sacan los campos del propio markdown de Fathom, que
 *   siempre trae secciones rotuladas ("Problema", "Obstáculo", "Contexto",
 *   "Próximos pasos"). Sale menos pulido, pero el borrador existe igual y el
 *   módulo no queda esperando una variable de entorno.
 *
 * Nunca pisa lo que alguien ya escribió a mano: solo completa campos vacíos.
 */

type Supabase = ReturnType<typeof createAdminClient>

export interface BorradorReporte {
  objecion: string | null
  situacion_actual: string | null
  dolores: string | null
  preguntas_no_resueltas: string | null
}

const CAMPOS: (keyof BorradorReporte)[] = ['objecion', 'situacion_actual', 'dolores', 'preguntas_no_resueltas']

/** Quita los enlaces de marcas de tiempo de Fathom: "[texto](https://fathom...)" → "texto". */
function limpiarMarkdown(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/\r/g, '')
}

/** Las viñetas cuyo rótulo coincide, sin el rótulo. */
function vinetasCon(lineas: string[], rotulo: RegExp): string[] {
  return lineas
    .map((l) => l.trim().replace(/^[-*]\s*/, ''))
    .filter((l) => {
      const m = l.match(/^([^:]{2,40}):\s*(.+)$/)
      return m ? rotulo.test(m[1]) : false
    })
    .map((l) => l.replace(/^[^:]{2,40}:\s*/, '').trim())
}

/** Las viñetas bajo un título "## Próximos pasos" o similar. */
function seccion(texto: string, titulo: RegExp): string[] {
  const bloques = texto.split(/\n(?=#{2,3}\s)/)
  const bloque = bloques.find((b) => titulo.test(b.split('\n')[0] ?? ''))
  if (!bloque) return []
  return bloque
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, ''))
}

function unir(lineas: string[]): string | null {
  const limpias = [...new Set(lineas.map((l) => l.trim()).filter(Boolean))]
  return limpias.length > 0 ? limpias.slice(0, 4).join(' ') : null
}

export function borradorSinModelo(resumen: string): BorradorReporte {
  const texto = limpiarMarkdown(resumen)
  const lineas = texto.split('\n')

  return {
    objecion: unir(vinetasCon(lineas, /obst[aá]culo|objeci[oó]n|barrera|duda|preocupaci[oó]n econ/i)),
    situacion_actual: unir(vinetasCon(lineas, /contexto|situaci[oó]n|actualmente|perfil/i)),
    dolores: unir(vinetasCon(lineas, /problema|dolor|preocupaci[oó]n principal|objetivo/i)),
    preguntas_no_resueltas: unir([
      ...vinetasCon(lineas, /pregunta|pendiente|resultado/i),
      ...seccion(texto, /pr[oó]ximos pasos|next steps|pendientes/i),
    ]),
  }
}

async function borradorConModelo(resumen: string): Promise<BorradorReporte | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Eres el asistente de una dirección de ventas. A partir del resumen de una llamada de venta, ' +
            'redactas el reporte en español neutral, breve y concreto (máximo dos oraciones por campo). ' +
            'Si el resumen no dice nada sobre un campo, devuelve null en ese campo. No inventes.',
        },
        {
          role: 'user',
          content:
            'Devuelve un JSON con las claves "objecion" (la objeción o motivo de no cierre), ' +
            '"situacion_actual" (situación actual del prospecto), "dolores" (lo que le duele o quiere resolver) y ' +
            '"preguntas_no_resueltas" (lo que quedó pendiente o sin responder).\n\nResumen:\n' +
            resumen.slice(0, 12_000),
        },
      ],
    }),
  })

  if (!res.ok) {
    console.error(`[reporte-llamada] OpenAI respondió ${res.status}: ${(await res.text()).slice(0, 300)}`)
    return null
  }

  try {
    const data = await res.json()
    const json = JSON.parse(data.choices?.[0]?.message?.content ?? '{}') as Record<string, unknown>
    const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    return {
      objecion: texto(json.objecion),
      situacion_actual: texto(json.situacion_actual),
      dolores: texto(json.dolores),
      preguntas_no_resueltas: texto(json.preguntas_no_resueltas),
    }
  } catch {
    return null
  }
}

export async function redactarBorrador(resumen: string): Promise<BorradorReporte> {
  return (await borradorConModelo(resumen)) ?? borradorSinModelo(resumen)
}

/**
 * Completa el borrador de una agenda y la deja en estado "borrador".
 *
 * Devuelve false si la agenda ya estaba aprobada o no tiene resumen: en esos
 * casos no hay nada que redactar.
 */
export async function completarBorradorDeAgenda(supabase: Supabase, agendaId: string): Promise<boolean> {
  const { data: agenda, error } = await supabase
    .from('agenda_records')
    .select('fathom_resumen, reporte_estado, objecion, situacion_actual, dolores, preguntas_no_resueltas')
    .eq('id', agendaId)
    .maybeSingle()

  if (error || !agenda?.fathom_resumen || agenda.reporte_estado === 'aprobado') return false

  const borrador = await redactarBorrador(agenda.fathom_resumen as string)
  const cambios: Record<string, string | null> = { reporte_estado: 'borrador' }
  for (const campo of CAMPOS) {
    const actual = agenda[campo] as string | null
    if (!actual?.trim() && borrador[campo]) cambios[campo] = borrador[campo]
  }

  const { error: errorUpdate } = await supabase
    .from('agenda_records')
    .update({ ...cambios, updated_at: new Date().toISOString() })
    .eq('id', agendaId)

  if (errorUpdate) {
    console.error(`[reporte-llamada] no se pudo guardar el borrador de ${agendaId}: ${errorUpdate.message}`)
    return false
  }
  return true
}
