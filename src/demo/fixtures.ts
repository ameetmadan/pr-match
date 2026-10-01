import type { DashboardMetrics, PullRequestDetails, Repository } from '../domain/types'

export const demoRepositories: Repository[] = [
  { id: 101, owner: 'northstar-labs', name: 'pr-match', fullName: 'northstar-labs/pr-match', description: 'A quieter way to keep projects moving.', htmlUrl: 'https://github.com/northstar-labs/pr-match', isPrivate: false, defaultBranch: 'develop', connectionId: 'demo' },
  { id: 102, owner: 'northstar-labs', name: 'fieldnotes', fullName: 'northstar-labs/fieldnotes', description: 'Small tools for noticing the useful details.', htmlUrl: 'https://github.com/northstar-labs/fieldnotes', isPrivate: true, defaultBranch: 'main', connectionId: 'demo' },
  { id: 103, owner: 'studio-south', name: 'studio-site', fullName: 'studio-south/studio-site', description: 'The public home for Studio South.', htmlUrl: 'https://github.com/studio-south/studio-site', isPrivate: false, defaultBranch: 'main', connectionId: 'demo' },
  { id: 104, owner: 'northstar-labs', name: 'tiny-forecast', fullName: 'northstar-labs/tiny-forecast', description: 'A clear view of what the week looks like.', htmlUrl: 'https://github.com/northstar-labs/tiny-forecast', isPrivate: false, defaultBranch: 'main', connectionId: 'demo' },
]

const today = new Date()
const hoursAgo = (hours: number) => new Date(today.getTime() - hours * 60 * 60 * 1000).toISOString()

export const demoMetrics: Record<number, DashboardMetrics> = {
  101: { openIssues: 7, openPullRequests: 4, mergedToday: 2, deployment: { url: 'https://pr-match-demo.vercel.app', environment: 'production', status: 'success', updatedAt: hoursAgo(2), pending: false, error: null }, fetchedAt: hoursAgo(0.1), stale: false, error: null },
  102: { openIssues: 12, openPullRequests: 3, mergedToday: 1, deployment: { url: 'https://fieldnotes-demo.vercel.app', environment: 'production', status: 'success', updatedAt: hoursAgo(7), pending: false, error: null }, fetchedAt: hoursAgo(0.2), stale: false, error: null },
  103: { openIssues: 3, openPullRequests: 2, mergedToday: 0, deployment: { url: 'https://studio-site-demo.vercel.app', environment: 'preview', status: 'success', updatedAt: hoursAgo(1), pending: true, error: null }, fetchedAt: hoursAgo(0.3), stale: false, error: null },
  104: { openIssues: 5, openPullRequests: 1, mergedToday: 3, deployment: { url: null, environment: 'production', status: 'failure', updatedAt: hoursAgo(5), pending: false, error: null }, fetchedAt: hoursAgo(0.4), stale: false, error: null },
}

export const demoPullRequests: PullRequestDetails[] = [
  {
    id: 5001, number: 42, repositoryId: 101, owner: 'northstar-labs', repository: 'pr-match', repositoryName: 'northstar-labs/pr-match', title: 'Keep the project cards calm when data is stale', body: 'Keep the last known numbers visible and say when they were fetched. Link to #31 for the data contract.', htmlUrl: 'https://github.com/northstar-labs/pr-match/pull/42', author: 'morganlee', authorId: 2201, createdAt: hoursAgo(36), updatedAt: hoursAgo(1), mergedAt: null, state: 'open', draft: false, headSha: 'a'.repeat(40), headBranch: 'fix/stale-project-data', baseBranch: 'develop', mergeable: true, mergeableState: 'clean', reviewDecision: 'APPROVED', additions: 61, deletions: 18, changedFiles: 5, connectionId: 'demo', ciSignals: [
      { kind: 'check', identity: '12:unit-tests', state: 'completed', conclusion: 'success', updatedAt: hoursAgo(1) },
      { kind: 'check', identity: '12:lint', state: 'completed', conclusion: 'success', updatedAt: hoursAgo(1) },
    ], ciComplete: true, linkedIssues: [{ number: 31, title: 'Show when dashboard data was last refreshed', url: 'https://github.com/northstar-labs/pr-match/issues/31' }], linkedIssuesKnown: true,
  },
  {
    id: 5002, number: 18, repositoryId: 102, owner: 'northstar-labs', repository: 'fieldnotes', repositoryName: 'northstar-labs/fieldnotes', title: 'Add a compact keyboard shortcut legend', body: 'Surface the shortcuts beside the review actions.', htmlUrl: 'https://github.com/northstar-labs/fieldnotes/pull/18', author: 'casey-r', authorId: 2202, createdAt: hoursAgo(26), updatedAt: hoursAgo(0.5), mergedAt: null, state: 'open', draft: false, headSha: 'b'.repeat(40), headBranch: 'feature/shortcut-legend', baseBranch: 'main', mergeable: true, mergeableState: 'clean', reviewDecision: 'APPROVED', additions: 34, deletions: 5, changedFiles: 2, connectionId: 'demo', ciSignals: [{ kind: 'check', identity: '8:build', state: 'completed', conclusion: 'success', updatedAt: hoursAgo(0.5) }], ciComplete: true, linkedIssues: [], linkedIssuesKnown: true,
  },
  {
    id: 5003, number: 77, repositoryId: 103, owner: 'studio-south', repository: 'studio-site', repositoryName: 'studio-south/studio-site', title: 'Tune the mobile project index spacing', body: 'The card grid needs a little more room below the intro.', htmlUrl: 'https://github.com/studio-south/studio-site/pull/77', author: 'sam-ng', authorId: 2203, createdAt: hoursAgo(18), updatedAt: hoursAgo(0.2), mergedAt: null, state: 'open', draft: false, headSha: 'c'.repeat(40), headBranch: 'polish/mobile-index', baseBranch: 'main', mergeable: true, mergeableState: 'clean', reviewDecision: 'REVIEW_REQUIRED', additions: 18, deletions: 7, changedFiles: 3, connectionId: 'demo', ciSignals: [{ kind: 'check', identity: '3:deploy-preview', state: 'in_progress', conclusion: null, updatedAt: hoursAgo(0.2) }], ciComplete: true, linkedIssues: [{ number: 72, title: 'Improve project index on small screens', url: 'https://github.com/studio-south/studio-site/issues/72' }], linkedIssuesKnown: true,
  },
]
