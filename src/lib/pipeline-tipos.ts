/**
 * Tipos y opciones del Pipeline de Agendas que comparten el servidor y la UI.
 *
 * Van en un archivo aparte porque un módulo con 'use server' solo puede
 * exportar funciones asíncronas: las constantes de las opciones de la ficha no
 * pueden vivir en las acciones.
 */

export type TipoTareaSistema = 'triaje_agenda' | 'asociar_lead' | 'reporte_llamada'

export const CALIFICA_OPCIONES = [
  { valor: 'si', etiqueta: 'Sí' },
  { valor: 'dudoso', etiqueta: 'Dudoso' },
  { valor: 'no', etiqueta: 'No' },
] as const

export const TEMPERATURA_OPCIONES = [
  { valor: 'fria', etiqueta: 'Fría' },
  { valor: 'tibia', etiqueta: 'Tibia' },
  { valor: 'caliente', etiqueta: 'Caliente' },
] as const

export const PRIORIDAD_OPCIONES = [
  { valor: 'alta', etiqueta: 'Alta' },
  { valor: 'media', etiqueta: 'Media' },
  { valor: 'baja', etiqueta: 'Baja' },
] as const

export type Califica = (typeof CALIFICA_OPCIONES)[number]['valor']
export type Temperatura = (typeof TEMPERATURA_OPCIONES)[number]['valor']
export type Prioridad = (typeof PRIORIDAD_OPCIONES)[number]['valor']

/** La ficha que la dirección de ventas le deja al closer. */
export interface FichaTriaje {
  califica: Califica
  temperatura: Temperatura
  objecion_prevista: string
  angulo: string
  prioridad: Prioridad
}

export function etiquetaDe<T extends { valor: string; etiqueta: string }>(
  opciones: readonly T[],
  valor: string | null | undefined
): string {
  return opciones.find((o) => o.valor === valor)?.etiqueta ?? '—'
}

export const ESTADOS_REPORTE = ['Show', 'No Show', 'Cerrado', 'No Cerrado', 'No Calificado', 'Reagendado'] as const
