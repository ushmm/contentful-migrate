const pad = (value: number, length = 2): string => String(value).padStart(length, '0')

/** Formats a date as `yyyymmddHHMMss` in UTC, the prefix used for migration file names. */
export const formatUtcTimestamp = (date: Date = new Date()): string =>
  `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
  `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`

/** Formats a date as `yyyy-mm-dd HH:MM:ss` in local time, for display. */
export const formatLocalDateTime = (value: Date | number): string => {
  const date = new Date(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Maps over items with at most `concurrency` mapper calls in flight, preserving input order. */
export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> => {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index], index)
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker)
  await Promise.all(workers)
  return results
}

/** Converts camelCase to dash-case, e.g. `blogPost` -> `blog-post`. */
export const camelToDash = (value: string): string =>
  value.replace(/([A-Z])/g, char => `-${char.toLowerCase()}`)

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
