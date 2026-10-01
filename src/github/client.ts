export interface ApiError {
  code: 'unauthorized' | 'forbidden' | 'rate_limit' | 'not_found' | 'network' | 'invalid_response' | 'unknown'
  message: string
  retryAt: number | null
}

export interface ApiPage<T> {
  data: T
  nextPath: string | null
}

export interface MergeRequestInput {
  connectionId: string
  repositoryId: number
  owner: string
  repository: string
  pullNumber: number
  headSha: string
  baseBranch: string
  method: 'merge' | 'squash' | 'rebase'
  filters: { allCiPassing: boolean; linkedIssue: boolean }
}

export interface MergeRequestResult {
  uuid: string | null
  status: 'pending' | 'merged' | 'enqueued' | 'failed'
  message: string | null
}

type WorkerResponse<T> = { ok: true; value: T } | { ok: false; error: ApiError }
const API_ORIGIN = 'https://api.github.com'

export function normalizeApiPath(value: string): string {
  try {
    const url = new URL(value, API_ORIGIN)
    if (url.origin !== API_ORIGIN || url.username || url.password || url.hash) {
      throw new Error()
    }
    return `${url.pathname}${url.search}`
  } catch {
    throw new Error('GitHub returned an invalid API URL.')
  }
}

export function sanitizeResponseError(status: number, retryAt: number | null, _body: string): ApiError {
  if (status === 401) return { code: 'unauthorized', message: 'GitHub rejected this token. Check it in Settings.', retryAt }
  if (status === 403 && retryAt && retryAt > Date.now()) {
    return { code: 'rate_limit', message: `GitHub rate limit reached. Try again after ${new Date(retryAt).toLocaleTimeString()}.`, retryAt }
  }
  if (status === 403) return { code: 'forbidden', message: 'This token needs additional repository permission or organization approval.', retryAt }
  if (status === 404) return { code: 'not_found', message: 'GitHub could not find this repository or pull request with the connected token.', retryAt }
  if ([405, 409, 422].includes(status)) return { code: 'invalid_response', message: 'GitHub could not complete this action. Refresh the item and review its current state.', retryAt }
  return { code: 'unknown', message: `GitHub returned an error (${status}). Try again.`, retryAt }
}

export function mapMergeResult(payload: Record<string, unknown>): MergeRequestResult {
  const status = payload.status
  if (status !== 'pending' && status !== 'merged' && status !== 'enqueued' && status !== 'failed') {
    throw new Error('GitHub returned an unknown merge result.')
  }
  const details = typeof payload.details === 'object' && payload.details !== null
    ? payload.details as Record<string, unknown>
    : {}
  return {
    uuid: typeof details.uuid === 'string' ? details.uuid : null,
    status,
    message: typeof details.message === 'string' ? details.message : null,
  }
}

export async function requestPage<T>(connectionId: string, path: string): Promise<ApiPage<T>> {
  const response = await chrome.runtime.sendMessage<
    { type: 'github.request'; connectionId: string; path: string },
    WorkerResponse<ApiPage<T>>
  >({ type: 'github.request', connectionId, path })
  if (!response?.ok) throw toError(response?.error)
  return response.value
}

export async function requestAll<T>(connectionId: string, path: string, continueWhile?: (item: T) => boolean): Promise<T[]> {
  const results: T[] = []
  const visited = new Set<string>()
  let nextPath: string | null = path
  while (nextPath) {
    if (visited.has(nextPath)) throw new Error('GitHub returned a repeated pagination link.')
    visited.add(nextPath)
    const page: ApiPage<T[]> = await requestPage<T[]>(connectionId, nextPath)
    results.push(...page.data)
    if (continueWhile && page.data.some((item) => !continueWhile(item))) break
    nextPath = page.nextPath
  }
  return results
}

export async function requestGraphql<T>(
  connectionId: string,
  query: string,
  variables: Record<string, string | number>,
): Promise<T> {
  const response = await chrome.runtime.sendMessage<
    { type: 'github.graphql'; connectionId: string; query: string; variables: Record<string, string | number> },
    WorkerResponse<{ data?: T; errors?: Array<{ message: string }> }>
  >({ type: 'github.graphql', connectionId, query, variables })
  if (!response?.ok) throw toError(response?.error)
  if (!response.value.data || response.value.errors?.length) throw new Error('GitHub could not load complete repository data.')
  return response.value.data
}

export async function submitMerge(input: MergeRequestInput): Promise<MergeRequestResult> {
  const response = await chrome.runtime.sendMessage<
    { type: 'github.merge'; input: MergeRequestInput },
    WorkerResponse<MergeRequestResult>
  >({ type: 'github.merge', input })
  if (!response?.ok) throw toError(response?.error)
  return response.value
}

export async function getMergeResult(
  connectionId: string,
  owner: string,
  repository: string,
  pullNumber: number,
  uuid: string,
): Promise<MergeRequestResult> {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls/${pullNumber}/merge-async/${encodeURIComponent(uuid)}`
  const page = await requestPage<Record<string, unknown>>(connectionId, path)
  return mapMergeResult(page.data)
}

function toError(error: ApiError | undefined): Error {
  if (!error) return new Error('The extension service worker did not return a response. Reload PR Match and try again.')
  return Object.assign(new Error(error.message), { code: error.code, retryAt: error.retryAt })
}
