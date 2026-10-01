export type CiState = 'passing' | 'failing' | 'pending' | 'empty' | 'unknown'

export interface CiSignal {
  kind: 'check' | 'status'
  identity: string
  state: string
  conclusion?: string | null
  updatedAt: string
}

export interface MergeCandidate {
  open: boolean
  draft: boolean
  mergeReady: boolean | null
  ci: CiState
  hasLinkedIssue: boolean | null
}

export interface EligibilityFilters {
  allCiPassing: boolean
  linkedIssue: boolean
}

export function evaluateCi(signals: CiSignal[], complete: boolean): CiState {
  if (!complete) return 'unknown'

  const latestByIdentity = new Map<string, CiSignal>()
  for (const signal of signals) {
    const key = `${signal.kind}:${signal.identity}`
    const previous = latestByIdentity.get(key)
    if (!previous || signal.updatedAt > previous.updatedAt) {
      latestByIdentity.set(key, signal)
    }
  }

  const latest = [...latestByIdentity.values()]
  if (latest.length === 0) return 'empty'

  if (latest.some((signal) => !isSuccessful(signal) && !isPending(signal))) return 'failing'
  if (latest.some(isPending)) return 'pending'
  return 'passing'
}

function isSuccessful(signal: CiSignal): boolean {
  if (signal.kind === 'check') {
    return signal.state === 'completed' && signal.conclusion === 'success'
  }
  return signal.state === 'success'
}

function isPending(signal: CiSignal): boolean {
  if (signal.kind === 'check') return signal.state !== 'completed'
  return signal.state === 'pending'
}

export function canMerge(candidate: MergeCandidate, filters: EligibilityFilters): boolean {
  if (!candidate.open || candidate.draft || candidate.mergeReady !== true) return false
  if (filters.allCiPassing && candidate.ci !== 'passing') return false
  if (filters.linkedIssue && candidate.hasLinkedIssue !== true) return false
  return true
}
