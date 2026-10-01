import { describe, expect, it } from 'vitest'
import { buildMergeRequestBody, canSubmitMerge, operationBlocksMerge } from './mergePolicy'

describe('canSubmitMerge', () => {
  it('requires the displayed commit, base branch, and a fresh mergeable state', () => {
    const displayed = { headSha: 'a'.repeat(40), baseBranch: 'main' }

    expect(canSubmitMerge(displayed, { open: true, draft: false, headSha: displayed.headSha, baseBranch: 'main', mergeable: true })).toBe(true)
    expect(canSubmitMerge(displayed, { open: true, draft: false, headSha: 'b'.repeat(40), baseBranch: 'main', mergeable: true })).toBe(false)
    expect(canSubmitMerge(displayed, { open: true, draft: false, headSha: displayed.headSha, baseBranch: 'release', mergeable: true })).toBe(false)
    expect(canSubmitMerge(displayed, { open: true, draft: false, headSha: displayed.headSha, baseBranch: 'main', mergeable: null })).toBe(false)
  })
})

describe('buildMergeRequestBody', () => {
  it('uses the displayed SHA and never bypasses repository rules', () => {
    expect(buildMergeRequestBody({
      headSha: 'a'.repeat(40),
      method: 'squash',
    })).toEqual({
      sha: 'a'.repeat(40),
      merge_method: 'squash',
      merge_action: 'direct_merge',
      bypass_rules: false,
    })
  })
})

describe('operationBlocksMerge', () => {
  it('locks submissions while the previous result is unresolved', () => {
    expect(operationBlocksMerge('submitting')).toBe(true)
    expect(operationBlocksMerge('pending')).toBe(true)
    expect(operationBlocksMerge('enqueued')).toBe(true)
    expect(operationBlocksMerge('unknown')).toBe(true)
    expect(operationBlocksMerge('merged')).toBe(false)
    expect(operationBlocksMerge('failed')).toBe(false)
  })
})
