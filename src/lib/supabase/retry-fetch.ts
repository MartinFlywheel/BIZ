/**
 * `fetch` con reintento para las lecturas contra Supabase.
 *
 * Los 500 que venían tumbando pantallas enteras llegaban a los logs como
 * `{ message: '' }`: sin código, sin detalle, sin hint. Esa firma no es la de
 * una consulta mal escrita —esas traen código de PostgREST, como el 57014 del
 * statement timeout— sino la de un corte de transporte entre Vercel y
 * Supabase. Ocurre y se va, pero una sola vez que ocurriera bastaba para dejar
 * un "This page couldn't load".
 *
 * Reintenta sólo lo que es seguro reintentar:
 *
 * - **Sólo GET.** Un POST/PATCH/DELETE repetido puede duplicar una escritura;
 *   ningún ahorro de un 500 justifica eso. En PostgREST las lecturas son GET,
 *   que es donde estaba el problema.
 * - **Sólo fallos de red y 5xx.** Un 4xx es una respuesta legítima del
 *   servidor (no existe, sin permiso, consulta inválida) y volver a pedirlo
 *   daría exactamente lo mismo, más lento.
 *
 * Dos intentos extra con espera creciente. Si después de eso sigue fallando,
 * el error sube tal cual: el problema es real y hay que verlo, no taparlo.
 */
const REINTENTOS = 2
const ESPERA_BASE_MS = 250

function esReintentable(method: string, res?: Response): boolean {
  if (method.toUpperCase() !== 'GET') return false
  // Sin respuesta = falló la red antes de llegar.
  if (!res) return true
  return res.status >= 500
}

export const fetchConReintento: typeof fetch = async (input, init) => {
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET')

  for (let intento = 0; ; intento++) {
    try {
      const res = await fetch(input, init)
      if (intento < REINTENTOS && esReintentable(method, res)) {
        await new Promise((r) => setTimeout(r, ESPERA_BASE_MS * (intento + 1)))
        continue
      }
      return res
    } catch (e) {
      // Un AbortError es intencional (el request se canceló porque nadie
      // espera ya la respuesta): reintentarlo sería trabajo tirado.
      const abortado = e instanceof Error && e.name === 'AbortError'
      if (abortado || intento >= REINTENTOS || !esReintentable(method)) throw e
      await new Promise((r) => setTimeout(r, ESPERA_BASE_MS * (intento + 1)))
    }
  }
}
