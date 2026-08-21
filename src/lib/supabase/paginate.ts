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
