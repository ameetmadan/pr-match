import { describe, expect, it } from 'vitest'
import { mapMergeResult, normalizeApiPath, sanitizeResponseError } from './client'

describe('normalizeApiPath', () => {
  it('turns GitHub pagination URLs into relative API paths', () => {
    expect(normalizeApiPath('https://api.github.com/repos/acme/app/pulls?page=2'))
      .toBe('/repos/acme/app/pulls?page=2')
  })

  it('rejects pagination links that could receive the stored token', () => {
    expect(() => normalizeApiPath('https://api.github.com.evil.test/repos/acme/app'))
      .toThrow('GitHub returned an invalid API URL.')
  })
})

describe('sanitizeResponseError', () => {
  it('never includes a raw response body in an authentication error', () => {
    const error = sanitizeResponseError(401, null, '{"message":"token ghp_secret-value"}')

    expect(error.code).toBe('unauthorized')
    expect(error.message).not.toContain('ghp_secret-value')
  })
})

describe('mapMergeResult', () => {
  it('keeps a merge queued separate from a confirmed merge', () => {
    const result = mapMergeResult({ status: 'enqueued', details: { uuid: 'merge-123', message: 'Queued' } })

    expect(result).toEqual({ uuid: 'merge-123', status: 'enqueued', message: 'Queued' })
  })

  it('rejects unknown merge response shapes', () => {
    expect(() => mapMergeResult({ status: 'maybe' }))
      .toThrow('GitHub returned an unknown merge result.')
  })
})
