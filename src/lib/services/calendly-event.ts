/**
 * Lee la descripción del evento que Calendly escribe en Google Calendar.
 *
 * Calendly Free no permite suscribirse a sus webhooks, así que el CRM se
 * entera de las reservas leyendo el calendario donde Calendly las escribe. Ese
 * evento trae en la descripción todo lo que la persona contestó al reservar:
 *
 *   Event Name: Llamada de diagnóstico
 *   Location: https://us02web.zoom.us/j/123
 *   Invitee: Juan Pérez
 *   Invitee Email: juan@correo.com
 *   Invitee Time Zone: America/Santiago
 *
 *   Questions:
 *   ¿Cuál es tu usuario de Instagram?: @juanperez
 *   ¿A qué se dedica tu negocio?: Estética
 *
 *   Need to make changes to this event?
 *   Cancel: https://calendly.com/cancellations/abc123
 *   Reschedule: https://calendly.com/reschedulings/abc123
 *
 * Dos cosas que hacen esto más frágil de lo que parece y por las que el parser
 * es defensivo:
 *
 * 1. Google entrega la descripción como HTML (con <br>, <a href> y entidades),
 *    no como el texto plano que se ve en pantalla.
 * 2. El formato lo decide Calendly, no nosotros. No es un contrato con nadie y
 *    puede cambiar sin aviso. Por eso nada acá lanza: si algo no se reconoce,
 *    ese campo queda en null y la agenda igual se crea con lo que sí se pudo
 *    leer. Perder el teléfono es molesto; perder la reserva entera, no.
 */

export interface EventoCalendly {
  /** Nombre del tipo de evento en Calendly ("Llamada de diagnóstico"). */
  tipoEvento: string | null
  nombre: string | null
  email: string | null
  telefono: string | null
  zonaHoraria: string | null
  /** Usuario de Instagram normalizado: minúsculas, sin @ ni URL. */
  instagram: string | null
  /** Identificador de la reserva, sacado del enlace de cancelación. */
  calendlyUuid: string | null
  /** Cada pregunta del formulario con su respuesta, tal como vinieron. */
  respuestas: Record<string, string>
}

/** Etiquetas con las que Calendly rotula cada dato, en inglés y español. */
const ETIQUETAS = {
  tipoEvento: ['event name', 'nombre del evento'],
  nombre: ['invitee', 'invitado', 'invitada'],
  email: ['invitee email', 'correo del invitado', 'correo electrónico del invitado'],
  zonaHoraria: ['invitee time zone', 'zona horaria del invitado'],
} as const

/** Preguntas del formulario que se reconocen como el Instagram del lead. */
const PREGUNTA_INSTAGRAM = /instagram|usuario de ig|@ de ig|\big\b/i

/** Preguntas que se reconocen como teléfono. */
const PREGUNTA_TELEFONO = /tel[eé]fono|celular|whatsapp|phone|m[oó]vil/i

/**
 * Etiquetas que abren una sección en vez de tener un valor propio. Nunca toman
 * como valor la línea de abajo.
 */
const ENCABEZADOS = new Set(['questions', 'preguntas'])

/**
 * Todas las etiquetas de campo conocidas, ya normalizadas. Solo estas se
 * aceptan como etiqueta cuando la línea no trae dos puntos.
 */
const ETIQUETAS_CONOCIDAS = new Set(
  Object.values(ETIQUETAS).flat().map(normalizarEtiqueta)
)

/**
 * HTML de Google → texto plano con saltos de línea reales.
 *
 * Se hace a mano y no con un parser de HTML porque esto corre en el servidor
 * sin DOM, y la entrada es un bloque acotado que genera siempre la misma
 * herramienta — no HTML arbitrario de internet.
 */
function aTextoPlano(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    // El texto de un enlace suele ser la propia URL; quedarse con el contenido
    // alcanza y evita arrastrar el href duplicado.
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n?/g, '\n')
}

/** Entidades con nombre que aparecen en texto en español. */
const ENTIDADES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü',
  iquest: '¿', iexcl: '¡', ordf: 'ª', ordm: 'º', deg: '°', euro: '€',
}

/**
 * Decodifica las entidades HTML del texto.
 *
 * Google entrega la descripción como HTML, así que las tildes llegan como
 * `&eacute;` y no como "é". Sin esto "Juan P&eacute;rez" nunca coincidiría con
 * el lead "Juan Pérez", y la pregunta "Tel&eacute;fono" no se reconocería como
 * teléfono. Se decodifica después de quitar las etiquetas, para que un `&lt;`
 * del texto no termine convertido en una etiqueta falsa.
 */
function decodificarEntidades(texto: string): string {
  return texto.replace(/&(#x?[0-9a-f]+|\w+);/gi, (original, cuerpo: string) => {
    if (cuerpo[0] === '#') {
      const num = cuerpo[1] === 'x' || cuerpo[1] === 'X'
        ? parseInt(cuerpo.slice(2), 16)
        : parseInt(cuerpo.slice(1), 10)
      return Number.isFinite(num) ? String.fromCodePoint(num) : original
    }
    // Se prueba tal cual y en minúsculas: `&Eacute;` y `&eacute;` son distintos,
    // pero `&AMP;` y `&amp;` son lo mismo.
    return ENTIDADES[cuerpo] ?? ENTIDADES[cuerpo.toLowerCase()] ?? original
  })
}

/** Normaliza una etiqueta para compararla: minúsculas, sin tildes ni dos puntos. */
function normalizarEtiqueta(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/:$/, '')
    .trim()
}

/**
 * Un usuario de Instagram, venga como venga.
 *
 * La gente escribe "@juan", "juan", "instagram.com/juan/" o la URL completa
 * con parámetros. Todo eso tiene que terminar igual, porque después se compara
 * contra el ig_username del lead para asociarlo.
 */
export function normalizarInstagram(valor: string | null | undefined): string | null {
  if (!valor) return null
  let v = valor.trim()
  if (!v) return null

  const url = v.match(/instagram\.com\/([^/?#\s]+)/i)
  if (url) v = url[1]

  v = v.replace(/^@/, '').replace(/\/+$/, '').trim().toLowerCase()
  // Un espacio significa que escribieron una frase, no un usuario.
  if (!v || /\s/.test(v)) return null
  return v
}

export function parsearEventoCalendly(descripcion: string | null | undefined): EventoCalendly {
  const vacio: EventoCalendly = {
    tipoEvento: null, nombre: null, email: null, telefono: null,
    zonaHoraria: null, instagram: null, calendlyUuid: null, respuestas: {},
  }
  if (!descripcion) return vacio

  const texto = decodificarEntidades(aTextoPlano(descripcion))
  const lineas = texto.split('\n').map((l) => l.trim()).filter(Boolean)

  const campos = new Map<string, string>()
  // Índices ya usados como valor de la línea anterior, para no volver a
  // leerlos como si fueran un campo propio.
  const consumidas = new Set<number>()

  for (let i = 0; i < lineas.length; i++) {
    if (consumidas.has(i)) continue
    const linea = lineas[i]
    // Las URLs traen "https://" y partirían mal por el primer ":".
    const corte = linea.indexOf(':')

    // Calendly escribe "Event Name" sin dos puntos, con el valor en la línea
    // siguiente. Una línea sin ":" solo se acepta como etiqueta si coincide
    // exactamente con un campo conocido; si no, es texto suelto de la
    // descripción y tomar la línea de abajo inventaría datos.
    if (corte <= 0) {
      const sola = normalizarEtiqueta(linea)
      if (!ETIQUETAS_CONOCIDAS.has(sola)) continue
      const siguiente = lineas[i + 1]
      if (!siguiente) continue
      if (!campos.has(sola)) campos.set(sola, siguiente)
      consumidas.add(i + 1)
      continue
    }

    const etiqueta = normalizarEtiqueta(linea.slice(0, corte))
    if (!etiqueta) continue

    let valor = linea.slice(corte + 1).trim()

    // Calendly a veces pone la etiqueta sola y el valor en la línea siguiente
    // ("Event Name:" y abajo el nombre). Los encabezados de sección quedan
    // fuera: "Questions:" abre un bloque, no tiene valor propio, y tomar la
    // línea de abajo se comería la primera pregunta.
    if (!valor && !ENCABEZADOS.has(etiqueta)) {
      const siguiente = lineas[i + 1]
      if (siguiente) {
        valor = siguiente
        consumidas.add(i + 1)
      }
    }

    if (!valor) continue
    // El primero gana: si una etiqueta se repite, la de arriba es la del
    // bloque de datos y la de abajo suele ser del pie del correo.
    if (!campos.has(etiqueta)) campos.set(etiqueta, valor)
  }

  function buscar(alternativas: readonly string[]): string | null {
    for (const a of alternativas) {
      const v = campos.get(normalizarEtiqueta(a))
      if (v) return v
    }
    return null
  }

  // Todo lo que no es un campo conocido es una respuesta del formulario. Se
  // guarda entero: el día que se agregue una pregunta nueva el dato ya va a
  // estar ahí en vez de haberse perdido.
  const conocidas = new Set(
    [
      ...Object.values(ETIQUETAS).flat(),
      'location', 'ubicación', 'ubicacion', 'questions', 'preguntas',
      'cancel', 'cancelar', 'reschedule', 'reprogramar',
      'need to make changes to this event?',
    ].map(normalizarEtiqueta)
  )

  const respuestas: Record<string, string> = {}
  for (const [etiqueta, valor] of campos) {
    if (conocidas.has(etiqueta)) continue
    if (/^https?$/.test(etiqueta)) continue
    respuestas[etiqueta] = valor
  }

  function respuestaQueCoincida(patron: RegExp): string | null {
    for (const [pregunta, valor] of Object.entries(respuestas)) {
      if (patron.test(pregunta)) return valor
    }
    return null
  }

  const cancelUrl = texto.match(/calendly\.com\/(?:cancellations|cancelaciones)\/([\w-]+)/i)
  const reprogramarUrl = texto.match(/calendly\.com\/(?:reschedulings|reprogramaciones)\/([\w-]+)/i)

  return {
    tipoEvento: buscar(ETIQUETAS.tipoEvento),
    nombre: buscar(ETIQUETAS.nombre),
    // El correo puede venir rotulado o suelto en el texto.
    email:
      buscar(ETIQUETAS.email)?.toLowerCase() ??
      texto.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0]?.toLowerCase() ??
      null,
    telefono: respuestaQueCoincida(PREGUNTA_TELEFONO),
    zonaHoraria: buscar(ETIQUETAS.zonaHoraria),
    instagram: normalizarInstagram(respuestaQueCoincida(PREGUNTA_INSTAGRAM)),
    calendlyUuid: cancelUrl?.[1] ?? reprogramarUrl?.[1] ?? null,
    respuestas,
  }
}
