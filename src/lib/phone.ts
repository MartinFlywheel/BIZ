// Normalización de teléfonos a E.164 ("+56912345678").
//
// Es la misma regla que la función normalizar_telefono() de
// supabase/059-leads-telefono-normalizado.sql. Si cambias una, cambia la
// otra: la base rellena leads.phone_e164 por trigger y el código busca con
// este valor, así que tienen que coincidir siempre.
//
// Se asume Chile (+56) cuando el número llega sin código de país.

const PAIS_DEFAULT = '56'

export function normalizarTelefono(entrada: string | null | undefined, paisDefault = PAIS_DEFAULT): string | null {
  if (entrada == null) return null
  const crudo = String(entrada).trim()
  if (!crudo) return null

  let conMas = crudo.startsWith('+')
  let digitos = crudo.replace(/\D/g, '')

  // "0056..." es la forma antigua de marcar internacional.
  if (!conMas && digitos.startsWith('00')) {
    digitos = digitos.slice(2)
    conMas = true
  }

  if (!digitos) return null

  // Con "+" delante, el número ya trae su código de país.
  if (conMas) {
    return digitos.length >= 8 && digitos.length <= 15 ? `+${digitos}` : null
  }

  // Celular chileno de 9 dígitos que empieza en 9.
  if (digitos.length === 9 && digitos.startsWith('9')) return `+${paisDefault}${digitos}`

  // Celular chileno con un 0 delante ("0912345678").
  if (digitos.length === 10 && digitos.startsWith('09')) return `+${paisDefault}${digitos.slice(1)}`

  // Ya trae el 56 delante ("56912345678").
  if (digitos.length === 11 && digitos.startsWith(paisDefault)) return `+${digitos}`

  // Celular chileno de 8 dígitos, sin el 9 inicial (forma vieja).
  if (digitos.length === 8) return `+${paisDefault}9${digitos}`

  // Otro país sin "+": se acepta si tiene largo razonable.
  if (digitos.length >= 10 && digitos.length <= 15) return `+${digitos}`

  return null
}

/**
 * Variantes con las que puede estar guardado un teléfono en leads.phone
 * antes de que exista la columna phone_e164. Sirve para buscar mientras la
 * migración 059 no se haya corrido.
 */
export function variantesTelefonoCrudo(e164: string): string[] {
  const digitos = e164.replace(/\D/g, '')
  const variantes = new Set<string>([e164, digitos])
  if (digitos.startsWith(PAIS_DEFAULT) && digitos.length === 11) {
    const local = digitos.slice(2)
    variantes.add(local)
    variantes.add(`0${local}`)
  }
  return [...variantes]
}
