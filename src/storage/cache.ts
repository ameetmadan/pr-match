export interface CachedValue<T> {
  value: T | null
  fetchedAt: string | null
  stale: boolean
  error: string | null
}

interface CacheEntry<T> {
  value: T
  fetchedAt: string
}

const TTL_MS = 5 * 60 * 1000

export async function readCached<T>(
  connectionId: string,
  key: string,
  load: () => Promise<T>,
): Promise<CachedValue<T>> {
  const storageKey = `api:${connectionId}:${key}`
  const stored = await chrome.storage.session.get(storageKey)
  const entry = isCacheEntry<T>(stored[storageKey]) ? stored[storageKey] : null
  if (entry && Date.now() - Date.parse(entry.fetchedAt) < TTL_MS) {
    return { value: entry.value, fetchedAt: entry.fetchedAt, stale: false, error: null }
  }

  try {
    const value = await load()
    const fetchedAt = new Date().toISOString()
    await chrome.storage.session.set({ [storageKey]: { value, fetchedAt } satisfies CacheEntry<T> })
    return { value, fetchedAt, stale: false, error: null }
  } catch (error) {
    return {
      value: entry?.value ?? null,
      fetchedAt: entry?.fetchedAt ?? null,
      stale: entry !== null,
      error: error instanceof Error ? error.message : 'Could not load GitHub data.',
    }
  }
}

function isCacheEntry<T>(value: unknown): value is CacheEntry<T> {
  return typeof value === 'object'
    && value !== null
    && 'fetchedAt' in value
    && typeof value.fetchedAt === 'string'
    && 'value' in value
}
