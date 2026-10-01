import type { MergeOperation } from '../domain/types'

export interface DisplayedPullRequestVersion {
  headSha: string
  baseBranch: string
}

export interface FreshPullRequestState extends DisplayedPullRequestVersion {
  open: boolean
  draft: boolean
  mergeable: boolean | null
}

export function canSubmitMerge(
  displayed: DisplayedPullRequestVersion,
  current: FreshPullRequestState,
): boolean {
  return current.open
    && !current.draft
    && current.headSha === displayed.headSha
    && current.baseBranch === displayed.baseBranch
    && current.mergeable === true
}

export function buildMergeRequestBody(input: {
  headSha: string
  method: 'merge' | 'squash' | 'rebase'
}): {
  sha: string
  merge_method: 'merge' | 'squash' | 'rebase'
  merge_action: 'direct_merge'
  bypass_rules: false
} {
  return {
    sha: input.headSha,
    merge_method: input.method,
    merge_action: 'direct_merge',
    bypass_rules: false,
  }
}

export function operationBlocksMerge(status: MergeOperation['status']): boolean {
  return status === 'submitting' || status === 'pending' || status === 'enqueued' || status === 'unknown'
}
