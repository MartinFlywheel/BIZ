// Supabase/PostgREST caps a single request at 1000 rows regardless of how
// many actually match a query — without paging through with .range(), a
// query silently truncates at 1000 as data grows past that, with no error.
// Wrap any query that isn't already bounded by a narrow filter (date range,
// specific IDs, a `.limit()` you chose deliberately) with this.
const PAGE_SIZE = 1000

export async function fetchAllRows<T>(
  // Supabase query builders are PromiseLike (thenable), not strict Promise
  // instances — accept either so a bare `.range(...)` builder can be passed
  // straight through without an extra `await` wrapper.
  queryFn: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const page = (n: number) => queryFn(n * PAGE_SIZE, n * PAGE_SIZE + PAGE_SIZE - 1)

  // Page 0 alone first — most callers never cross PAGE_SIZE rows, so the
  // common case stays a single round trip with no batching overhead.
  const first = await page(0)
  if (first.error) throw first.error
  const allRows: T[] = [...(first.data ?? [])]
  if (!first.data || first.data.length < PAGE_SIZE) return allRows

  // Past PAGE_SIZE rows: a table like `leads` or `interactions` on a busy
  // client can run to a dozen-plus pages, and fetching those one at a time
  // (awaiting each before requesting the next) made that the single
  // slowest thing on the whole page. Fetch the rest in batches that double
  // each round — 1, 2, 4, 8 pages at once — instead, so an 11k-row table
  // takes ~4 sequential round trips instead of ~12, bounded overfetch on
  // the last (partial) batch since those extra requests just come back
  // empty fast.
  let nextPage = 1
  let batchSize = 2
  while (true) {
    const results = await Promise.all(
      Array.from({ length: batchSize }, (_, i) => page(nextPage + i))
    )

    let reachedEnd = false
    for (const { data, error } of results) {
      if (error) throw error
      if (!data || data.length === 0) { reachedEnd = true; break }
      allRows.push(...data)
      if (data.length < PAGE_SIZE) { reachedEnd = true; break }
    }

    if (reachedEnd) break
    nextPage += batchSize
    batchSize *= 2
  }

  return allRows
}

// OFFSET pagination (fetchAllRows above) gets more expensive with every
// page — Postgres has to scan and discard everything before the offset,
// so a deep page on a table with 10k+ rows for one client can turn into a
// multi-second scan, and several of those firing in the same batch can
// trip Supabase's statement timeout outright (seen in production on a
// client with 10k+ leads, right after a bulk delete added extra load).
// Keyset pagination via the primary key avoids that: each page seeks
// straight to `id > cursor` using the primary key index, so page 20 costs
// the same as page 1 regardless of table size. It's sequential (each
// page's cursor depends on the previous page), not batched/parallel like
// fetchAllRows, but each page stays cheap, which is what actually matters
// here. Order-agnostic — callers sort the fully materialized result
// themselves once everything's in memory.
export async function fetchAllRowsByCursor<T extends { id: string }>(
  queryFn: (cursor: string | null, limit: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const allRows: T[] = []
  let cursor: string | null = null

  while (true) {
    const { data, error } = await queryFn(cursor, PAGE_SIZE)
    if (error) throw error
    if (!data || data.length === 0) break
    allRows.push(...data)
    if (data.length < PAGE_SIZE) break
    cursor = data[data.length - 1].id
  }

  return allRows
}

// Un `.in('id', ids)` tambien esta sujeto al tope de 1000 filas: pedir 2500
// ids devuelve 1000 y las otras 1500 desaparecen sin error, igual que un
// select sin paginar. Y una lista de ids muy larga en la URL (PostgREST
// consulta por GET) puede pasarse del limite de largo de la URL antes de eso.
//
// Esto parte los ids en tandas y las pide en paralelo. CHUNK esta bien por
// debajo del tope de 1000 a proposito: deja margen para que una tanda nunca
// devuelva exactamente el maximo y quede la duda de si se trunco.
const ID_CHUNK = 500

export async function fetchAllByIds<T>(
  ids: string[],
  queryFn: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  if (ids.length === 0) return []

  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK))

  const results = await Promise.all(chunks.map((chunk) => queryFn(chunk)))

  const rows: T[] = []
  for (const { data, error } of results) {
    if (error) throw error
    if (data) rows.push(...data)
  }
  return rows
}
