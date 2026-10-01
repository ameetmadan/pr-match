import type { ConnectionSummary, DashboardMetrics, DeploymentLink, Pin, PullRequest, PullRequestDetails, Repository } from '../domain/types'
import { evaluateCi } from '../domain/filters'
import { selectProductionDeployment } from '../domain/deployments'
import { countMergedToday, countOpenIssues, getLocalDayRange } from '../domain/metrics'
import { readCached, type CachedValue } from '../storage/cache'
import { requestAll, requestGraphql, requestPage } from './client'
import { linkedIssuesQuery, repositorySummaryQuery } from './queries'

interface GitHubRepo {
  id: number
  name: string
  full_name: string
  owner: { login: string }
  description: string | null
  html_url: string
  private: boolean
  default_branch: string
}

interface GitHubPull {
  id: number
  number: number
  title: string
  body: string | null
  html_url: string
  user: { login: string; id: number }
  created_at: string
  updated_at: string
  merged_at: string | null
  state: 'open' | 'closed'
  draft?: boolean
  head: { sha: string; ref: string }
  base: { ref: string }
  mergeable: boolean | null
  mergeable_state: string | null
  additions: number
  deletions: number
  changed_files: number
}

interface GitHubCheckRun {
  name: string
  app: { id: number } | null
  status: string
  conclusion: string | null
  updated_at: string
}

interface GitHubCommitStatus {
  context: string
  state: string
  updated_at: string
}

interface GitHubIssue {
  number: number
  pull_request?: unknown
}

interface GitHubDeployment {
  id: number
  environment: string
  production_environment: boolean
  transient_environment: boolean
  created_at: string
}

interface GitHubDeploymentStatus {
  state: string
  environment: string
  environment_url: string | null
  created_at: string
}

interface GraphqlPage<T> {
  repository: T | null
}

interface QueueLoadResult {
  pullRequests: PullRequest[]
  failedRepositories: string[]
}

export async function listRepositories(connection: ConnectionSummary): Promise<CachedValue<Repository[]>> {
  return readCached(connection.id, 'repositories', async () => {
    const repos = await requestAll<GitHubRepo>(
      connection.id,
      '/user/repos?affiliation=owner%2Ccollaborator%2Corganization_member&visibility=all&sort=full_name&per_page=100',
    )
    return repos.map((repo) => mapRepository(repo, connection.id))
  })
}

export async function loadReviewQueue(repositories: Repository[]): Promise<QueueLoadResult> {
  const failedRepositories: string[] = []
  const pullRequests = await mapWithLimit(repositories, 4, async (repository) => {
    try {
      const cached = await readCached(repository.connectionId, `open-prs:${repository.id}`, async () => {
        const pulls = await requestAll<GitHubPull>(
          repository.connectionId,
          `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls?state=open&sort=created&direction=asc&per_page=100`,
        )
        return pulls.map((pull) => mapPullRequest(pull, repository))
      })
      if (!cached.value) {
        failedRepositories.push(repository.fullName)
        return []
      }
      return cached.value
    } catch {
      failedRepositories.push(repository.fullName)
      return []
    }
  })
  const unique = new Map<number, PullRequest>()
  for (const pull of pullRequests.flat()) unique.set(pull.id, pull)
  return {
    pullRequests: [...unique.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.repositoryId - b.repositoryId || a.number - b.number),
    failedRepositories,
  }
}

export async function getPullRequestDetails(pull: PullRequest): Promise<PullRequestDetails> {
  const path = `/repos/${encodeURIComponent(pull.owner)}/${encodeURIComponent(pull.repository)}/pulls/${pull.number}`
  const fresh = await requestPage<GitHubPull>(pull.connectionId, path)
  const repository: Repository = {
    id: pull.repositoryId,
    owner: pull.owner,
    name: pull.repository,
    fullName: pull.repositoryName,
    description: null,
    htmlUrl: `https://github.com/${pull.repositoryName}`,
    isPrivate: false,
    defaultBranch: pull.baseBranch,
    connectionId: pull.connectionId,
  }
  const current = mapPullRequest(fresh.data, repository)
  if (current.headSha !== pull.headSha || current.baseBranch !== pull.baseBranch) {
    return { ...current, ciSignals: [], ciComplete: false, linkedIssues: [], linkedIssuesKnown: false }
  }

  const [checkResult, statusResult, issueResult] = await Promise.allSettled([
    requestAll<GitHubCheckRun>(pull.connectionId, `/repos/${encodeURIComponent(pull.owner)}/${encodeURIComponent(pull.repository)}/commits/${pull.headSha}/check-runs?filter=latest&per_page=100`),
    requestAll<GitHubCommitStatus>(pull.connectionId, `/repos/${encodeURIComponent(pull.owner)}/${encodeURIComponent(pull.repository)}/commits/${pull.headSha}/statuses?per_page=100`),
    loadLinkedIssues(pull),
  ])

  const checks = checkResult.status === 'fulfilled' ? checkResult.value : []
  const statuses = statusResult.status === 'fulfilled' ? statusResult.value : []
  const ciSignals = [
    ...checks.map((check) => ({
      kind: 'check' as const,
      identity: `${check.app?.id ?? 'unknown'}:${check.name}`,
      state: check.status,
      conclusion: check.conclusion,
      updatedAt: check.updated_at,
    })),
    ...statuses.map((status) => ({
      kind: 'status' as const,
      identity: status.context,
      state: status.state,
      updatedAt: status.updated_at,
    })),
  ]

  let linkedIssues: PullRequestDetails['linkedIssues'] = []
  let linkedIssuesKnown = false
  let reviewDecision: string | null = null
  if (issueResult.status === 'fulfilled') {
    linkedIssues = issueResult.value.issues
    linkedIssuesKnown = issueResult.value.complete
    reviewDecision = issueResult.value.reviewDecision
  }

  return {
    ...current,
    reviewDecision,
    ciSignals,
    ciComplete: checkResult.status === 'fulfilled' && statusResult.status === 'fulfilled',
    linkedIssues,
    linkedIssuesKnown,
  }
}

export function getCiState(details: PullRequestDetails) {
  return evaluateCi(details.ciSignals, details.ciComplete)
}

export async function getDashboardMetrics(
  repository: Repository,
  pin: Pin,
  now = new Date(),
): Promise<DashboardMetrics> {
  const [summary, issueItems, closedPulls, deployment] = await Promise.all([
    readCached(repository.connectionId, `summary:${repository.id}`, () => getRepositorySummary(repository)),
    readCached(repository.connectionId, `open-issues:${repository.id}`, () => requestAll<GitHubIssue>(
      repository.connectionId,
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues?state=open&per_page=100`,
    )),
    readCached(repository.connectionId, `closed-prs:${repository.id}:${localDayStart(now)}`, () => getRecentlyClosedPulls(repository, now)),
    readCached(repository.connectionId, `deployments:${repository.id}:${pin.environment ?? 'auto'}:${pin.deploymentUrl ?? ''}`, () => resolveDeployment(repository, pin)),
  ])

  const fallbackIssueCount = issueItems.value ? countOpenIssues(issueItems.value) : null
  const mergedToday = closedPulls.value ? countMergedToday(
    closedPulls.value.map((pull) => pull.merged_at),
    now,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ) : null
  const metrics: DashboardMetrics = {
    openIssues: summary.value?.issues ?? fallbackIssueCount,
    openPullRequests: summary.value?.pullRequests ?? null,
    mergedToday,
    deployment: deployment.value ?? manualDeployment(pin, deployment.error),
    fetchedAt: [summary.fetchedAt, issueItems.fetchedAt, closedPulls.fetchedAt, deployment.fetchedAt].filter(Boolean).sort().at(-1) ?? new Date().toISOString(),
    stale: summary.stale || issueItems.stale || closedPulls.stale || deployment.stale,
    error: summary.error ?? issueItems.error ?? closedPulls.error ?? deployment.error,
  }
  return metrics
}

export function mapRepository(repo: GitHubRepo, connectionId: string): Repository {
  return {
    id: repo.id,
    owner: repo.owner.login,
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description,
    htmlUrl: repo.html_url,
    isPrivate: repo.private,
    defaultBranch: repo.default_branch,
    connectionId,
  }
}

function mapPullRequest(pull: GitHubPull, repository: Repository): PullRequest {
  return {
    id: pull.id,
    number: pull.number,
    repositoryId: repository.id,
    owner: repository.owner,
    repository: repository.name,
    repositoryName: repository.fullName,
    title: pull.title,
    body: pull.body,
    htmlUrl: pull.html_url,
    author: pull.user.login,
    authorId: pull.user.id,
    createdAt: pull.created_at,
    updatedAt: pull.updated_at,
    mergedAt: pull.merged_at,
    state: pull.state,
    draft: pull.draft ?? false,
    headSha: pull.head.sha,
    headBranch: pull.head.ref,
    baseBranch: pull.base.ref,
    mergeable: pull.mergeable,
    mergeableState: pull.mergeable_state,
    reviewDecision: null,
    additions: pull.additions,
    deletions: pull.deletions,
    changedFiles: pull.changed_files,
    connectionId: repository.connectionId,
  }
}

async function loadLinkedIssues(pull: PullRequest): Promise<{
  issues: PullRequestDetails['linkedIssues']
  reviewDecision: string | null
  complete: boolean
}> {
  const response = await requestGraphql<GraphqlPage<{
    pullRequest: { reviewDecision: string | null; closingIssuesReferences: { nodes: Array<{ number: number; title: string; url: string }>; pageInfo: { hasNextPage: boolean } } } | null
  }>>(pull.connectionId, linkedIssuesQuery, { owner: pull.owner, name: pull.repository, number: pull.number })
  const refs = response.repository?.pullRequest?.closingIssuesReferences
  return {
    issues: refs?.nodes ?? [],
    reviewDecision: response.repository?.pullRequest?.reviewDecision ?? null,
    complete: Boolean(refs && !refs.pageInfo.hasNextPage),
  }
}

async function getRepositorySummary(repository: Repository): Promise<{ issues: number; pullRequests: number }> {
  const response = await requestGraphql<GraphqlPage<{ issues: { totalCount: number }; pullRequests: { totalCount: number } }>>(
    repository.connectionId,
    repositorySummaryQuery,
    { owner: repository.owner, name: repository.name },
  )
  if (!response.repository) throw new Error('GitHub did not return this repository.')
  return { issues: response.repository.issues.totalCount, pullRequests: response.repository.pullRequests.totalCount }
}

async function getRecentlyClosedPulls(repository: Repository, now: Date): Promise<GitHubPull[]> {
  const { start } = getLocalDayRange(now, Intl.DateTimeFormat().resolvedOptions().timeZone)
  return requestAll<GitHubPull>(
    repository.connectionId,
    `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls?state=closed&sort=updated&direction=desc&per_page=100`,
    (pull) => Date.parse(pull.updated_at) >= start.getTime(),
  )
}

async function resolveDeployment(repository: Repository, pin: Pin): Promise<DeploymentLink> {
  if (pin.deploymentUrl) {
    const url = safeHttpsUrl(pin.deploymentUrl)
    if (!url) return { url: null, environment: pin.environment ?? null, status: null, updatedAt: null, pending: false, error: 'The saved deployment link must be a valid HTTPS URL.' }
    return { url, environment: pin.environment ?? 'Custom link', status: 'custom', updatedAt: null, pending: false, error: null }
  }

  const deployments = await requestAll<GitHubDeployment>(
    repository.connectionId,
    `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/deployments?per_page=100`,
  )
  const eligible = deployments.filter((deployment) => {
    if (pin.environment) return deployment.environment.toLowerCase() === pin.environment.toLowerCase() && !deployment.transient_environment
    return deployment.production_environment || (!deployment.transient_environment && deployment.environment.toLowerCase() === 'production')
  })
  const candidates = await mapWithLimit(eligible.slice(0, 20), 3, async (deployment) => {
    const statuses = await requestAll<GitHubDeploymentStatus>(
      repository.connectionId,
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/deployments/${deployment.id}/statuses?per_page=100`,
    )
    const latest = statuses.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null
    return {
      id: deployment.id,
      environment: deployment.environment,
      productionEnvironment: deployment.production_environment,
      transient: deployment.transient_environment,
      createdAt: deployment.created_at,
      latestStatus: latest ? { state: latest.state, url: latest.environment_url, environment: latest.environment, createdAt: latest.created_at } : null,
    }
  })
  const result = selectProductionDeployment(candidates, pin.environment)
  return eligible.length > 20 && !result.url ? { ...result, error: 'More than 20 deployments need review. Choose an environment or add a manual link.' } : result
}

function manualDeployment(pin: Pin, error: string | null): DeploymentLink {
  const url = pin.deploymentUrl ? safeHttpsUrl(pin.deploymentUrl) : null
  return { url, environment: pin.environment ?? null, status: url ? 'custom' : null, updatedAt: null, pending: false, error }
}

async function mapWithLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      result[index] = await mapper(items[index])
    }
  }))
  return result
}

function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

function localDayStart(now: Date): number {
  return getLocalDayRange(now, Intl.DateTimeFormat().resolvedOptions().timeZone).start.getTime()
}
