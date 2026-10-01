export interface ConnectionSummary {
  id: string
  owner: string
  login: string
  userId: number
  addedAt: string
}

export interface StoredConnection extends ConnectionSummary {
  token: string
}

export interface Repository {
  id: number
  owner: string
  name: string
  fullName: string
  description: string | null
  htmlUrl: string
  isPrivate: boolean
  defaultBranch: string
  connectionId: string
}

export interface PullRequest {
  id: number
  number: number
  repositoryId: number
  owner: string
  repository: string
  repositoryName: string
  title: string
  body: string | null
  htmlUrl: string
  author: string
  authorId: number
  createdAt: string
  updatedAt: string
  mergedAt: string | null
  state: 'open' | 'closed'
  draft: boolean
  headSha: string
  headBranch: string
  baseBranch: string
  mergeable: boolean | null
  mergeableState: string | null
  reviewDecision: string | null
  additions: number
  deletions: number
  changedFiles: number
  connectionId: string
}

export interface Pin {
  repositoryId: number
  connectionId: string
  owner: string
  repository: string
  order: number
  environment?: string
  deploymentUrl?: string
  mergeMethod?: 'merge' | 'squash' | 'rebase'
}

export interface ReviewFilters {
  repositoryId: number | null
  authoredByMe: boolean
  allCiPassing: boolean
  linkedIssue: boolean
  readyToMerge: boolean
}

export interface DeploymentLink {
  url: string | null
  environment: string | null
  status: string | null
  updatedAt: string | null
  pending: boolean
  error: string | null
}

export interface DashboardMetrics {
  openIssues: number | null
  openPullRequests: number | null
  mergedToday: number | null
  deployment: DeploymentLink
  fetchedAt: string
  stale: boolean
  error: string | null
}

export interface CiSignal {
  kind: 'check' | 'status'
  identity: string
  state: string
  conclusion?: string | null
  updatedAt: string
}

export interface PullRequestDetails extends PullRequest {
  ciSignals: CiSignal[]
  ciComplete: boolean
  linkedIssues: Array<{ number: number; title: string; url: string }>
  linkedIssuesKnown: boolean
}

export interface MergeOperation {
  id: string
  connectionId: string
  repositoryId: number
  owner: string
  repository: string
  pullNumber: number
  headSha: string
  mergeMethod: 'merge' | 'squash' | 'rebase'
  status: 'submitting' | 'pending' | 'merged' | 'enqueued' | 'failed' | 'unknown'
  message: string | null
  updatedAt: string
}
