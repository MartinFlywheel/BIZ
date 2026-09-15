/**
 * Comparación de nombres de personas escritos a mano.
 *
 * El mismo prospecto aparece escrito de muchas formas: "Paola barrera" en la
 * planilla, "Paola Barrera" en Calendly, "Pao Barrera 🌸" en Instagram, y el
 * título del evento de Calendly lo trae como "Paola Barrera and Mane". Para
 * cruzar agendas manuales con las del calendario, y grabaciones de Fathom con
 * agendas, hace falta compararlos sin tildes, sin emojis y por palabras.
 *
 * No se usa en ningún lugar como único criterio para escribir algo: siempre
 * acompaña a la fecha, la hora o el correo. Un nombre por sí solo se repite
 * demasiado ("María") para asociar nada con él.
 */

/** Palabras que aparecen en títulos y nombres pero no identifican a nadie. */
const RELLENO = new Set([
  'and', 'y', 'e', 'de', 'del', 'la', 'las', 'los', 'el', 'con', 'para', 'x',
  'call', 'llamada', 'meeting', 'reunion', 'sesion', 'session', 'mentoria',
  'estrategia', 'consulta', 'agenda', 'with', 'the',
])

/** Minúsculas, sin tildes, sin emojis ni signos, con espacios simples. */
export function normalizarNombre(texto: string | null | undefined): string {
  if (!texto) return ''
  return texto
    .normalize('NFD')
    // Las marcas diacríticas que NFD separa de la letra (U+0300 a U+036F).
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Las palabras que identifican a la persona, sin relleno ni iniciales sueltas. */
export function tokensDeNombre(texto: string | null | undefined): string[] {
  return [...new Set(normalizarNombre(texto).split(' ').filter((t) => t.length >= 3 && !RELLENO.has(t)))]
}

/**
 * Si el nombre de la agenda aparece en alguno de los textos.
 *
 * Con uno o dos tokens basta una palabra en común (la gente reserva con el
 * nombre de pila, o con el apellido y un apodo); con tres o más se piden dos,
 * para que un segundo nombre común no alcance solo.
 */
export function nombreCoincide(
  nombreAgenda: string | null | undefined,
  textos: (string | null | undefined)[],
  excluir: (string | null | undefined)[] = []
): boolean {
  const propios = tokensDeNombre(nombreAgenda)
  if (propios.length === 0) return false

  const fuera = new Set(excluir.flatMap((e) => tokensDeNombre(e)))
  const objetivo = new Set(textos.flatMap((t) => tokensDeNombre(t)).filter((t) => !fuera.has(t)))
  if (objetivo.size === 0) return false

  const comunes = propios.filter((t) => objetivo.has(t)).length
  return propios.length <= 2 ? comunes >= 1 : comunes >= 2
}

/** Mismo nombre normalizado completo. Para decidir duplicados, que es más delicado. */
export function mismoNombre(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizarNombre(a)
  return na.length > 0 && na === normalizarNombre(b)
}
