import type { ConnectionSummary, MergeOperation, Pin, ReviewFilters } from '../domain/types'
import type { MergeRequestResult } from '../github/client'

export interface AppSettings {
  pins: Pin[]
  filters: ReviewFilters
  mergeMethod: 'merge' | 'squash' | 'rebase'
  demoMode: boolean
}

const SETTINGS_KEY = 'appSettings'
const defaults: AppSettings = {
  pins: [],
  filters: { repositoryId: null, authoredByMe: false, allCiPassing: true, linkedIssue: false, readyToMerge: true },
  mergeMethod: 'squash',
  demoMode: true,
}

type WorkerResponse<T> = { ok: true; value: T } | { ok: false; error: { message: string } }

export async function loadSettings(): Promise<AppSettings> {
  const record = await chrome.storage.local.get(SETTINGS_KEY)
  const value = record[SETTINGS_KEY] as Partial<AppSettings> | undefined
  return {
    pins: Array.isArray(value?.pins) ? value.pins.filter(isPin) : defaults.pins,
    filters: isReviewFilters(value?.filters) ? value.filters : defaults.filters,
    mergeMethod: value?.mergeMethod === 'merge' || value?.mergeMethod === 'rebase' ? value.mergeMethod : 'squash',
    demoMode: typeof value?.demoMode === 'boolean' ? value.demoMode : defaults.demoMode,
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings })
}

export async function listConnections(): Promise<ConnectionSummary[]> {
  return sendMessage<ConnectionSummary[]>({ type: 'connection.list' })
}

export async function addConnection(token: string, owner: string): Promise<ConnectionSummary> {
  return sendMessage<ConnectionSummary>({ type: 'connection.add', token, owner })
}

export async function removeConnection(connectionId: string): Promise<void> {
  await sendMessage<null>({ type: 'connection.remove', connectionId })
}

export async function listMergeOperations(): Promise<Array<{ key: string; operation: MergeOperation }>> {
  return sendMessage<Array<{ key: string; operation: MergeOperation }>>({ type: 'merge.list' })
}

export async function pollMergeOperation(key: string, uuid: string): Promise<MergeRequestResult> {
  return sendMessage<MergeRequestResult>({ type: 'github.merge.poll', key, uuid })
}

export async function reconcileMergeOperation(key: string): Promise<MergeOperation> {
  return sendMessage<MergeOperation>({ type: 'github.merge.reconcile', key })
}

async function sendMessage<T>(message: object): Promise<T> {
  const response = await chrome.runtime.sendMessage<typeof message, WorkerResponse<T>>(message)
  if (!response?.ok) throw new Error(response?.error?.message ?? 'The extension background service did not respond. Reload PR Match.')
  return response.value
}

function isPin(value: unknown): value is Pin {
  if (typeof value !== 'object' || value === null) return false
  const pin = value as Partial<Pin>
  return Number.isSafeInteger(pin.repositoryId)
    && typeof pin.connectionId === 'string'
    && typeof pin.owner === 'string'
    && typeof pin.repository === 'string'
    && typeof pin.order === 'number'
    && (pin.mergeMethod === undefined || pin.mergeMethod === 'merge' || pin.mergeMethod === 'squash' || pin.mergeMethod === 'rebase')
}

function isReviewFilters(value: unknown): value is ReviewFilters {
  if (typeof value !== 'object' || value === null) return false
  const filters = value as Partial<ReviewFilters>
  return (filters.repositoryId === null || typeof filters.repositoryId === 'number')
    && typeof filters.authoredByMe === 'boolean'
    && typeof filters.allCiPassing === 'boolean'
    && typeof filters.linkedIssue === 'boolean'
    && typeof filters.readyToMerge === 'boolean'
}
