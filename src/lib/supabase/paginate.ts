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
  const allRows: T[] = []
  let from = 0

  while (true) {
    const { data, error } = await queryFn(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break

    allRows.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return allRows
}
