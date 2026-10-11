/** Continue until an empty page, even when the server caps pages below our limit. */
export async function fetchAllPages<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 500,
): Promise<T[]> {
  const result: T[] = [];
  for (;;) {
    const { data, error } = await fetchPage(
      result.length,
      result.length + pageSize - 1,
    );
    if (error) throw new Error(error.message);
    if (!data?.length) return result;
    result.push(...data);
  }
}
