export const repositorySummaryQuery = `
  query RepositorySummary($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      issues(states: OPEN) { totalCount }
      pullRequests(states: OPEN) { totalCount }
    }
  }
`

export const linkedIssuesQuery = `
  query PullRequestClosingIssues($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewDecision
        mergeStateStatus
        closingIssuesReferences(first: 100) {
          nodes { number title url }
          pageInfo { hasNextPage }
        }
      }
    }
  }
`

export const mergeReadinessQuery = `
  query PullRequestMergeReadiness($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) { reviewDecision mergeStateStatus }
    }
  }
`
