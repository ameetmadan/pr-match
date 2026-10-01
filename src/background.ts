import type { ApiError, MergeRequestInput, MergeRequestResult } from './github/client'
import type { ConnectionSummary, MergeOperation, StoredConnection } from './domain/types'
import { mapMergeResult, normalizeApiPath, sanitizeResponseError } from './github/client'
import { buildMergeRequestBody, canSubmitMerge, operationBlocksMerge } from './github/mergePolicy'
import { evaluateCi } from './domain/filters'
import { linkedIssuesQuery, mergeReadinessQuery } from './github/queries'

const API_ORIGIN = 'https://api.github.com'
const API_VERSION = '2026-03-10'
const CONNECTIONS_KEY = 'connections'
const OPERATIONS_KEY = 'mergeOperations'
const LAST_TAB_KEY = 'dashboardTabId'
const extensionRoot = chrome.runtime.getURL('')
const mergeLocks = new Set<string>()

type ExtensionMessage =
  | { type: 'connection.list' }
  | { type: 'connection.add'; token: string; owner: string }
  | { type: 'connection.remove'; connectionId: string }
  | { type: 'merge.list' }
  | { type: 'github.request'; connectionId: string; path: string }
  | { type: 'github.graphql'; connectionId: string; query: string; variables: Record<string, string | number> }
  | { type: 'github.merge'; input: MergeRequestInput }
  | { type: 'github.merge.poll'; key: string; uuid: string }
  | { type: 'github.merge.reconcile'; key: string }

type WorkerResponse<T> = { ok: true; value: T } | { ok: false; error: ApiError }

chrome.action.onClicked.addListener(() => {
  void openDashboard()
})

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (!sender.url?.startsWith(extensionRoot)) return false
  void handleMessage(message).then(sendResponse).catch((error: unknown) => {
    sendResponse({ ok: false, error: normalizeError(error) })
  })
  return true
})

async function openDashboard(): Promise<void> {
  const saved = await chrome.storage.session.get(LAST_TAB_KEY)
  const tabId = saved[LAST_TAB_KEY]
  if (typeof tabId === 'number') {
    try {
      const tab = await chrome.tabs.get(tabId)
      await chrome.tabs.update(tabId, { active: true })
      await chrome.windows.update(tab.windowId!, { focused: true })
      return
    } catch {
      await chrome.storage.session.remove(LAST_TAB_KEY)
    }
  }

  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('index.html') })
  if (tab.id !== undefined) await chrome.storage.session.set({ [LAST_TAB_KEY]: tab.id })
}

async function handleMessage(message: ExtensionMessage): Promise<WorkerResponse<unknown>> {
  try {
    switch (message.type) {
      case 'connection.list':
        return { ok: true, value: await listConnections() }
      case 'connection.add':
        return { ok: true, value: await addConnection(message.token, message.owner) }
      case 'connection.remove':
        await removeConnection(message.connectionId)
        return { ok: true, value: null }
      case 'merge.list':
        return { ok: true, value: await listMergeOperations() }
      case 'github.request':
        return { ok: true, value: await readFromGitHub(message.connectionId, message.path) }
      case 'github.graphql':
        return { ok: true, value: await queryGitHub(message.connectionId, message.query, message.variables) }
      case 'github.merge':
        return { ok: true, value: await mergePullRequest(message.input) }
      case 'github.merge.poll':
        return { ok: true, value: await pollMergeResult(message.key, message.uuid) }
      case 'github.merge.reconcile':
        return { ok: true, value: await reconcileMergeOperation(message.key) }
    }
  } catch (error) {
    return { ok: false, error: normalizeError(error) }
  }
}

async function listConnections(): Promise<ConnectionSummary[]> {
  const stored = await chrome.storage.local.get(CONNECTIONS_KEY)
  const connections = (stored[CONNECTIONS_KEY] ?? []) as StoredConnection[]
  return connections.map(({ token: _token, ...summary }) => summary)
}

async function addConnection(tokenInput: string, ownerInput: string): Promise<ConnectionSummary> {
  const token = tokenInput.trim()
  const owner = ownerInput.trim()
  if (!/^github_pat_[A-Za-z0-9_]+$/.test(token)) {
    throw new ApiRequestError('invalid_response', 'Enter a GitHub fine-grained personal access token.')
  }
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner)) {
    throw new ApiRequestError('invalid_response', 'Enter a valid GitHub account or organization name.')
  }

  const response = await authorizedFetch(token, '/user')
  if (!response.ok) throw await responseError(response)
  const user = await response.json() as { id?: number; login?: string }
  if (typeof user.id !== 'number' || typeof user.login !== 'string') {
    throw new ApiRequestError('invalid_response', 'GitHub did not return a valid account for this token.')
  }

  const current = (await chrome.storage.local.get(CONNECTIONS_KEY))[CONNECTIONS_KEY] as StoredConnection[] | undefined ?? []
  if (current.some((connection) => connection.userId !== user.id)) {
    throw new ApiRequestError('invalid_response', 'Connect each owner with a token for the same GitHub user.')
  }

  const id = `${user.id}:${owner.toLowerCase()}`
  const summary: ConnectionSummary = { id, owner, login: user.login, userId: user.id, addedAt: new Date().toISOString() }
  await chrome.storage.local.set({ [CONNECTIONS_KEY]: [...current.filter((connection) => connection.id !== id), { ...summary, token }] })
  await clearConnectionCache(id)
  return summary
}

async function removeConnection(connectionId: string): Promise<void> {
  const connections = (await chrome.storage.local.get(CONNECTIONS_KEY))[CONNECTIONS_KEY] as StoredConnection[] | undefined ?? []
  await chrome.storage.local.set({ [CONNECTIONS_KEY]: connections.filter((connection) => connection.id !== connectionId) })
  await clearConnectionCache(connectionId)
}

async function listMergeOperations(): Promise<Array<{ key: string; operation: MergeOperation }>> {
  const stored = (await chrome.storage.local.get(OPERATIONS_KEY))[OPERATIONS_KEY] as Record<string, MergeOperation> | undefined ?? {}
  return Object.entries(stored).map(([key, operation]) => ({ key, operation }))
}

async function readFromGitHub(connectionId: string, path: string): Promise<{ data: unknown; nextPath: string | null }> {
  const url = new URL(normalizeApiPath(path), API_ORIGIN)
  const response = await authorizedFetch(await getToken(connectionId), url.href)
  if (!response.ok) throw await responseError(response)
  return { data: await parseJson(response), nextPath: parseNextPath(response.headers.get('Link')) }
}

async function queryGitHub(
  connectionId: string,
  query: string,
  variables: Record<string, string | number>,
): Promise<unknown> {
  if (typeof query !== 'string' || query.length > 20000 || !/^\s*query\b/.test(query)) {
    throw new ApiRequestError('invalid_response', 'Only bounded, read-only GitHub queries are allowed.')
  }
  const response = await authorizedFetch(await getToken(connectionId), '/graphql', {
    method: 'POST',
    body: JSON.stringify({ query, variables }),
  })
  if (!response.ok) throw await responseError(response)
  return parseJson(response)
}

async function mergePullRequest(input: MergeRequestInput): Promise<MergeRequestResult> {
  const key = mergeKey(input)
  if (mergeLocks.has(key)) throw new ApiRequestError('unknown', 'A merge is already being submitted. Refresh its status before trying again.')
  mergeLocks.add(key)
  try {
    return await submitMergeRequest(input)
  } finally {
    mergeLocks.delete(key)
  }
}

async function submitMergeRequest(input: MergeRequestInput): Promise<MergeRequestResult> {
  const { connectionId, owner, repository, pullNumber, headSha, baseBranch, method } = input
  if (!Number.isSafeInteger(pullNumber) || pullNumber < 1 || !/^[a-f0-9]{40}$/i.test(headSha)) {
    throw new ApiRequestError('invalid_response', 'The pull request reference is invalid.')
  }
  if (!['merge', 'squash', 'rebase'].includes(method) || !isGitHubName(owner) || !isGitHubName(repository)) {
    throw new ApiRequestError('invalid_response', 'The repository or merge method is invalid.')
  }

  const key = mergeKey(input)
  const operations = (await readOperations())
  const prior = operations[key]
  if (prior && operationBlocksMerge(prior.status)) {
    throw new ApiRequestError('unknown', 'A merge is already in progress. Refresh its status before trying again.')
  }

  const intent: MergeOperation = {
    id: crypto.randomUUID(),
    connectionId,
    repositoryId: input.repositoryId,
    owner,
    repository,
    pullNumber,
    headSha,
    mergeMethod: method,
    status: 'submitting',
    message: null,
    updatedAt: new Date().toISOString(),
  }
  operations[key] = intent
  await chrome.storage.local.set({ [OPERATIONS_KEY]: operations })

  let mutationStarted = false
  try {
    const token = await getToken(connectionId)
    const pullResponse = await authorizedFetch(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls/${pullNumber}`)
    if (!pullResponse.ok) throw await responseError(pullResponse)
    const pull = await parseJson(pullResponse) as {
      state?: string; draft?: boolean; head?: { sha?: string }; base?: { ref?: string }; stack?: unknown
      mergeable?: boolean | null; mergeable_state?: string
    }
    if (!canSubmitMerge(
      { headSha, baseBranch },
      {
        open: pull.state === 'open',
        draft: pull.draft === true,
        headSha: pull.head?.sha ?? '',
        baseBranch: pull.base?.ref ?? '',
        mergeable: pull.mergeable === true && pull.mergeable_state === 'clean',
      },
    )) {
      throw new ApiRequestError('invalid_response', 'The pull request changed or is no longer ready. Refresh it and review the new state.')
    }
    if (pull.stack) throw new ApiRequestError('invalid_response', 'This pull request belongs to a stack. Open it on GitHub to review the full stack before merging.')

    const readinessResponse = await authorizedFetch(token, '/graphql', { method: 'POST', body: JSON.stringify({ query: mergeReadinessQuery, variables: { owner, name: repository, number: pullNumber } }) })
    if (!readinessResponse.ok) throw await responseError(readinessResponse)
    const readinessPayload = await parseJson(readinessResponse) as { data?: { repository?: { pullRequest?: { reviewDecision?: string | null; mergeStateStatus?: string | null } | null } | null }; errors?: unknown[] }
    const readiness = readinessPayload.data?.repository?.pullRequest
    if (readinessPayload.errors?.length || !readiness || readiness.mergeStateStatus !== 'CLEAN' || readiness.reviewDecision === 'CHANGES_REQUESTED' || readiness.reviewDecision === 'REVIEW_REQUIRED') {
      throw new ApiRequestError('invalid_response', 'Reviews or merge readiness changed. Open GitHub to review the latest requirements before merging.')
    }

    const repositoryResponse = await authorizedFetch(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`)
    if (!repositoryResponse.ok) throw await responseError(repositoryResponse)
    const repositoryState = await parseJson(repositoryResponse) as { allow_merge_commit?: boolean; allow_squash_merge?: boolean; allow_rebase_merge?: boolean }
    const methodAllowed = method === 'merge' ? repositoryState.allow_merge_commit : method === 'squash' ? repositoryState.allow_squash_merge : repositoryState.allow_rebase_merge
    if (!methodAllowed) throw new ApiRequestError('invalid_response', 'This repository does not allow the selected merge method. Change the method in Settings.')

    if (input.filters.allCiPassing) await ensureChecksPass(token, owner, repository, headSha)
    if (input.filters.linkedIssue) await ensureLinkedIssue(token, owner, repository, pullNumber)

    mutationStarted = true
    const response = await authorizedFetch(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls/${pullNumber}/merge-async`, {
      method: 'PUT',
      body: JSON.stringify(buildMergeRequestBody({ headSha, method })),
    })
    let payload: Record<string, unknown>
    if (response.status === 409) {
      payload = await parseJson(response) as Record<string, unknown>
      const duplicate = mapMergeResult({ status: 'pending', details: payload.details })
      if (!duplicate.uuid) throw new ApiRequestError('unknown', 'GitHub reports a merge may already be running but did not return its operation ID. Refresh its status before retrying.')
      return await saveOperationResult(key, intent, duplicate)
    }
    if (!response.ok) throw await responseError(response)
    try {
      payload = await parseJson(response) as Record<string, unknown>
      return await saveOperationResult(key, intent, mapMergeResult(payload))
    } catch {
      throw new ApiRequestError('unknown', 'GitHub accepted the merge request but its result could not be read. Refresh its status before retrying.')
    }
  } catch (error) {
    const normalized = normalizeError(error)
    const status: MergeOperation['status'] = mutationStarted && normalized.code !== 'invalid_response' && normalized.code !== 'forbidden' ? 'unknown' : 'failed'
    operations[key] = { ...intent, status, message: normalized.message, updatedAt: new Date().toISOString() }
    await chrome.storage.local.set({ [OPERATIONS_KEY]: operations })
    throw error
  }
}

async function ensureChecksPass(token: string, owner: string, repository: string, headSha: string): Promise<void> {
  const checks = await readAllFromGitHub<Record<string, unknown>>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits/${headSha}/check-runs?filter=latest&per_page=100`)
  const statuses = await readAllFromGitHub<Record<string, unknown>>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits/${headSha}/statuses?per_page=100`)
  const ciSignals = [
    ...checks.map((check) => ({ kind: 'check' as const, identity: `${(check.app as { id?: number } | null)?.id ?? 'unknown'}:${String(check.name ?? '')}`, state: String(check.status ?? ''), conclusion: typeof check.conclusion === 'string' ? check.conclusion : null, updatedAt: String(check.updated_at ?? '') })),
    ...statuses.map((status) => ({ kind: 'status' as const, identity: String(status.context ?? ''), state: String(status.state ?? ''), updatedAt: String(status.updated_at ?? '') })),
  ]
  if (evaluateCi(ciSignals, true) !== 'passing') throw new ApiRequestError('invalid_response', 'The latest CI checks no longer all pass. Refresh the pull request before merging.')
}

async function ensureLinkedIssue(token: string, owner: string, repository: string, pullNumber: number): Promise<void> {
  const response = await authorizedFetch(token, '/graphql', { method: 'POST', body: JSON.stringify({ query: linkedIssuesQuery, variables: { owner, name: repository, number: pullNumber } }) })
  if (!response.ok) throw await responseError(response)
  const payload = await parseJson(response) as { data?: { repository?: { pullRequest?: { closingIssuesReferences?: { nodes?: unknown[]; pageInfo?: { hasNextPage?: boolean } } | null } | null } | null }; errors?: unknown[] }
  const refs = payload.data?.repository?.pullRequest?.closingIssuesReferences
  if (payload.errors?.length || !refs || refs.pageInfo?.hasNextPage || !refs.nodes?.length) {
    throw new ApiRequestError('invalid_response', 'A current linked closing issue could not be confirmed. Refresh the pull request before merging.')
  }
}

async function readAllFromGitHub<T>(token: string, path: string): Promise<T[]> {
  const results: T[] = []
  const visited = new Set<string>()
  let nextPath: string | null = path
  while (nextPath) {
    if (visited.has(nextPath)) throw new ApiRequestError('invalid_response', 'GitHub returned a repeated pagination link.')
    visited.add(nextPath)
    const response = await authorizedFetch(token, nextPath)
    if (!response.ok) throw await responseError(response)
    const payload = await parseJson(response)
    const data = Array.isArray(payload)
      ? payload
      : typeof payload === 'object' && payload !== null && Array.isArray((payload as Record<string, unknown>).check_runs)
        ? (payload as { check_runs: unknown[] }).check_runs
        : null
    if (!data) throw new ApiRequestError('invalid_response', 'GitHub returned invalid check data.')
    results.push(...data as T[])
    nextPath = parseNextPath(response.headers.get('Link'))
  }
  return results
}

async function pollMergeResult(key: string, uuid: string): Promise<MergeRequestResult> {
  const operations = await readOperations()
  const operation = operations[key]
  if (!operation || operation.id !== uuid || !operation.connectionId) {
    throw new ApiRequestError('not_found', 'There is no matching merge operation to refresh.')
  }
  const path = `/repos/${encodeURIComponent(operation.owner)}/${encodeURIComponent(operation.repository)}/pulls/${operation.pullNumber}/merge-async/${encodeURIComponent(uuid)}`
  const response = await authorizedFetch(await getToken(operation.connectionId), path)
  if (!response.ok) throw await responseError(response)
  const result = mapMergeResult(await parseJson(response) as Record<string, unknown>)
  operations[key] = { ...operation, status: result.status, message: result.message, updatedAt: new Date().toISOString() }
  await chrome.storage.local.set({ [OPERATIONS_KEY]: operations })
  if (result.status === 'merged') await clearConnectionCache(operation.connectionId)
  return result
}

async function reconcileMergeOperation(key: string): Promise<MergeOperation> {
  const operations = await readOperations()
  const operation = operations[key]
  if (!operation) throw new ApiRequestError('not_found', 'There is no saved merge operation to refresh.')
  if ((operation.status === 'pending' || operation.status === 'enqueued') && operation.id) {
    await pollMergeResult(key, operation.id)
    return (await readOperations())[key]
  }
  const response = await authorizedFetch(await getToken(operation.connectionId), `/repos/${encodeURIComponent(operation.owner)}/${encodeURIComponent(operation.repository)}/pulls/${operation.pullNumber}`)
  if (!response.ok) throw await responseError(response)
  const pull = await parseJson(response) as { state?: string; merged_at?: string | null }
  const status: MergeOperation['status'] = pull.merged_at ? 'merged' : pull.state === 'closed' ? 'failed' : 'unknown'
  const message = pull.merged_at
    ? 'This pull request is merged on GitHub, but PR Match could not confirm which request completed it.'
    : pull.state === 'closed'
      ? 'This pull request closed without a confirmed result for this merge request.'
      : 'This pull request is still open. No second merge request was sent; check GitHub before retrying.'
  const reconciled = { ...operation, status, message, updatedAt: new Date().toISOString() }
  operations[key] = reconciled
  await chrome.storage.local.set({ [OPERATIONS_KEY]: operations })
  if (status === 'merged') await clearConnectionCache(operation.connectionId)
  return reconciled
}

async function saveOperationResult(key: string, intent: MergeOperation, result: MergeRequestResult): Promise<MergeRequestResult> {
  const operations = await readOperations()
  operations[key] = {
    ...intent,
    id: result.uuid ?? intent.id,
    status: result.status,
    message: result.message,
    updatedAt: new Date().toISOString(),
  }
  await chrome.storage.local.set({ [OPERATIONS_KEY]: operations })
  if (result.status === 'merged') await clearConnectionCache(intent.connectionId)
  return result
}

function mergeKey(input: MergeRequestInput): string {
  return `${input.connectionId}:${input.repositoryId}#${input.pullNumber}`
}

async function readOperations(): Promise<Record<string, MergeOperation>> {
  return (await chrome.storage.local.get(OPERATIONS_KEY))[OPERATIONS_KEY] as Record<string, MergeOperation> | undefined ?? {}
}

function parseNextPath(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  const next = linkHeader.split(',').find((part) => part.includes('rel="next"'))
  const match = next?.match(/<([^>]+)>/)
  return match ? normalizeApiPath(match[1]) : null
}

async function getToken(connectionId: string): Promise<string> {
  const connections = (await chrome.storage.local.get(CONNECTIONS_KEY))[CONNECTIONS_KEY] as StoredConnection[] | undefined ?? []
  const connection = connections.find((item) => item.id === connectionId)
  if (!connection) throw new ApiRequestError('unauthorized', 'Reconnect this GitHub owner in Settings.')
  return connection.token
}

async function authorizedFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const safePath = normalizeApiPath(path)
  const url = new URL(safePath, API_ORIGIN)
  return fetch(url, {
    ...init,
    redirect: 'error',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
}

async function responseError(response: Response): Promise<ApiRequestError> {
  const retryHeader = response.headers.get('X-RateLimit-Reset')
  const retryAt = retryHeader ? Number(retryHeader) * 1000 : null
  const safe = sanitizeResponseError(response.status, retryAt, '')
  return new ApiRequestError(safe.code, safe.message, safe.retryAt)
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new ApiRequestError('invalid_response', 'GitHub returned a response the extension could not read.')
  }
}

async function clearConnectionCache(connectionId: string): Promise<void> {
  const entries = await chrome.storage.session.get(null)
  const keys = Object.keys(entries).filter((key) => key.startsWith(`api:${connectionId}:`))
  if (keys.length) await chrome.storage.session.remove(keys)
}

function isGitHubName(value: string): boolean {
  return /^[A-Za-z0-9_.-]{1,100}$/.test(value)
}

function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiRequestError) return { code: error.code, message: error.message, retryAt: error.retryAt }
  return { code: 'network', message: 'Could not reach GitHub. Check your connection and retry.', retryAt: null }
}

class ApiRequestError extends Error {
  constructor(readonly code: ApiError['code'], message: string, readonly retryAt: number | null = null) {
    super(message)
  }
}
