import { describe, expect, it } from 'vitest'
import { countMergedToday, countOpenIssues, getLocalDayRange } from './metrics'

describe('countMergedToday', () => {
  it('counts merged timestamps inside the local day and ignores closed-only PRs', () => {
    const result = countMergedToday([
      '2026-10-01T00:00:00Z',
      '2026-10-01T23:59:59Z',
      '2026-10-02T00:00:00Z',
      null,
    ], new Date('2026-10-01T12:00:00Z'), 'UTC')

    expect(result).toBe(2)
  })
})

describe('countOpenIssues', () => {
  it('excludes pull requests from GitHub issue search results', () => {
    const result = countOpenIssues([
      { number: 3, title: 'Bug' },
      { number: 4, title: 'Feature request' },
      { number: 5, title: 'Pull request', pull_request: { url: 'https://api.github.com/repos/acme/app/pulls/5' } },
    ])

    expect(result).toBe(2)
  })
})

describe('getLocalDayRange', () => {
  it('uses a 23-hour UTC range for a daylight-saving transition day', () => {
    const range = getLocalDayRange(new Date('2026-03-08T12:00:00Z'), 'America/Los_Angeles')

    expect(range.start.toISOString()).toBe('2026-03-08T08:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-03-09T07:00:00.000Z')
  })
})
