import { describe, expect, it } from 'vitest'
import { selectProductionDeployment } from './deployments'

describe('selectProductionDeployment', () => {
  it('uses a later successful status when an older deployment is promoted afterward', () => {
    const result = selectProductionDeployment([
      { id: 2, environment: 'production', productionEnvironment: true, transient: false, createdAt: '2026-09-30T10:00:00Z', latestStatus: { state: 'success', url: 'https://deploy-2.example.com', environment: 'production', createdAt: '2026-10-01T10:00:00Z' } },
      { id: 3, environment: 'production', productionEnvironment: true, transient: false, createdAt: '2026-10-01T09:00:00Z', latestStatus: { state: 'failure', url: 'https://deploy-3.example.com', environment: 'production', createdAt: '2026-10-01T11:00:00Z' } },
    ])

    expect(result.url).toBe('https://deploy-2.example.com/')
    expect(result.status).toBe('success')
    expect(result.pending).toBe(false)
  })

  it('does not use an older success after the deployment becomes inactive', () => {
    const result = selectProductionDeployment([
      { id: 5, environment: 'production', productionEnvironment: true, transient: false, createdAt: '2026-10-01T10:00:00Z', latestStatus: { state: 'inactive', url: 'https://old.example.com', environment: 'production', createdAt: '2026-10-01T12:00:00Z' } },
    ])

    expect(result.url).toBe(null)
    expect(result.status).toBe('inactive')
  })

  it('honors an explicitly selected custom environment', () => {
    const result = selectProductionDeployment([
      { id: 8, environment: 'live', productionEnvironment: false, transient: false, createdAt: '2026-10-01T10:00:00Z', latestStatus: { state: 'success', url: 'https://live.example.com', environment: 'live', createdAt: '2026-10-01T10:10:00Z' } },
      { id: 9, environment: 'production', productionEnvironment: true, transient: false, createdAt: '2026-10-01T11:00:00Z', latestStatus: { state: 'success', url: 'https://prod.example.com', environment: 'production', createdAt: '2026-10-01T11:10:00Z' } },
    ], 'live')

    expect(result.url).toBe('https://live.example.com/')
    expect(result.environment).toBe('live')
  })

  it('asks the user to choose when production environments are ambiguous', () => {
    const result = selectProductionDeployment([
      { id: 18, environment: 'production', productionEnvironment: true, transient: false, createdAt: '2026-10-01T10:00:00Z', latestStatus: { state: 'success', url: 'https://prod.example.com', environment: 'production', createdAt: '2026-10-01T10:10:00Z' } },
      { id: 19, environment: 'live', productionEnvironment: true, transient: false, createdAt: '2026-10-01T11:00:00Z', latestStatus: { state: 'success', url: 'https://live.example.com', environment: 'live', createdAt: '2026-10-01T11:10:00Z' } },
    ])

    expect(result.url).toBe(null)
    expect(result.error).toMatch(/choose one/i)
  })

  it('retains the last successful link while reporting a newer failed deployment', () => {
    const result = selectProductionDeployment([
      { id: 20, environment: 'production', productionEnvironment: true, transient: false, createdAt: '2026-10-01T08:00:00Z', latestStatus: { state: 'success', url: 'https://good.example.com', environment: 'production', createdAt: '2026-10-01T09:00:00Z' } },
      { id: 21, environment: 'production', productionEnvironment: true, transient: false, createdAt: '2026-10-01T10:00:00Z', latestStatus: { state: 'failure', url: 'https://bad.example.com', environment: 'production', createdAt: '2026-10-01T11:00:00Z' } },
    ])

    expect(result.url).toBe('https://good.example.com/')
    expect(result.error).toMatch(/newer deployment is failure/i)
  })

  it('never selects a preview or non-HTTPS URL as production', () => {
    const result = selectProductionDeployment([
      { id: 10, environment: 'preview', productionEnvironment: false, transient: true, createdAt: '2026-10-01T10:00:00Z', latestStatus: { state: 'success', url: 'https://preview.example.com', environment: 'preview', createdAt: '2026-10-01T10:00:00Z' } },
      { id: 11, environment: 'production', productionEnvironment: true, transient: false, createdAt: '2026-10-01T09:00:00Z', latestStatus: { state: 'success', url: 'http://unsafe.example.com', environment: 'production', createdAt: '2026-10-01T09:00:00Z' } },
    ])

    expect(result.url).toBe(null)
  })
})
