export interface IssueSearchItem {
  number?: number
  title?: string
  pull_request?: unknown
}

export function countOpenIssues(items: IssueSearchItem[]): number {
  return items.filter((item) => !('pull_request' in item)).length
}

export function countMergedToday(
  mergedAtValues: Array<string | null>,
  now: Date,
  timeZone: string,
): number {
  const { start, end } = getLocalDayRange(now, timeZone)
  return mergedAtValues.filter((value) => {
    if (!value) return false
    const mergedAt = new Date(value)
    return Number.isFinite(mergedAt.getTime()) && mergedAt >= start && mergedAt < end
  }).length
}

export function getLocalDayRange(now: Date, timeZone: string): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now)
  const year = Number(getPart(parts, 'year'))
  const month = Number(getPart(parts, 'month'))
  const day = Number(getPart(parts, 'day'))
  const localStart = Date.UTC(year, month - 1, day)
  const localEnd = Date.UTC(year, month - 1, day + 1)

  return {
    start: localMidnightUtc(localStart, timeZone),
    end: localMidnightUtc(localEnd, timeZone),
  }
}

function localMidnightUtc(localMidnight: number, timeZone: string): Date {
  let candidate = localMidnight
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(new Date(candidate))
    const representedLocalTime = Date.UTC(
      Number(getPart(parts, 'year')),
      Number(getPart(parts, 'month')) - 1,
      Number(getPart(parts, 'day')),
      Number(getPart(parts, 'hour')),
      Number(getPart(parts, 'minute')),
      Number(getPart(parts, 'second')),
    )
    const corrected = localMidnight - (representedLocalTime - candidate)
    if (corrected === candidate) return new Date(candidate)
    candidate = corrected
  }
  return new Date(candidate)
}

function getPart(parts: Intl.DateTimeFormatPart[], type: string): string {
  const value = parts.find((part) => part.type === type)?.value
  if (!value) throw new Error(`Could not resolve local date part: ${type}`)
  return value
}
