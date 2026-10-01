import { describe, expect, it } from 'vitest'
import { canMerge, evaluateCi } from './filters'

describe('evaluateCi', () => {
  it('passes only when every current check and status has succeeded', () => {
    const result = evaluateCi([
      { kind: 'check', identity: '42:unit-tests', state: 'completed', conclusion: 'success', updatedAt: '2026-10-01T09:00:00Z' },
      { kind: 'status', identity: 'deploy-preview', state: 'success', updatedAt: '2026-10-01T09:01:00Z' },
    ], true)

    expect(result).toBe('passing')
  })

  it('does not treat neutral checks as passing', () => {
    const result = evaluateCi([
      { kind: 'check', identity: '42:lint', state: 'completed', conclusion: 'neutral', updatedAt: '2026-10-01T09:00:00Z' },
    ], true)

    expect(result).toBe('failing')
  })

  it('keeps queued checks pending until they complete', () => {
    const result = evaluateCi([
      { kind: 'check', identity: '42:unit-tests', state: 'queued', conclusion: null, updatedAt: '2026-10-01T09:00:00Z' },
    ], true)

    expect(result).toBe('pending')
  })

  it('uses the latest attempt for a check identity', () => {
    const result = evaluateCi([
      { kind: 'check', identity: '42:unit-tests', state: 'completed', conclusion: 'failure', updatedAt: '2026-10-01T08:00:00Z' },
      { kind: 'check', identity: '42:unit-tests', state: 'completed', conclusion: 'success', updatedAt: '2026-10-01T09:00:00Z' },
    ], true)

    expect(result).toBe('passing')
  })

  it('does not pass a partial check response', () => {
    const result = evaluateCi([
      { kind: 'check', identity: '42:unit-tests', state: 'completed', conclusion: 'success', updatedAt: '2026-10-01T09:00:00Z' },
    ], false)

    expect(result).toBe('unknown')
  })

  it('distinguishes no reported checks from passing checks', () => {
    expect(evaluateCi([], true)).toBe('empty')
  })
})

describe('canMerge', () => {
  it('blocks when the selected CI filter fails even if GitHub reports mergeable', () => {
    const allowed = canMerge(
      { open: true, draft: false, mergeReady: true, ci: 'failing', hasLinkedIssue: false },
      { allCiPassing: true, linkedIssue: false },
    )

    expect(allowed).toBe(false)
  })

  it('blocks unknown readiness even when optional filters are disabled', () => {
    const allowed = canMerge(
      { open: true, draft: false, mergeReady: null, ci: 'passing', hasLinkedIssue: null },
      { allCiPassing: false, linkedIssue: false },
    )

    expect(allowed).toBe(false)
  })
})
