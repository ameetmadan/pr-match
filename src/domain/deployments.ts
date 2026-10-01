import type { DeploymentLink } from './types'

export interface DeploymentCandidate {
  id: number
  environment: string
  productionEnvironment: boolean
  transient: boolean
  createdAt: string
  latestStatus: {
    state: string
    url: string | null
    environment: string
    createdAt: string
  } | null
}

export function selectProductionDeployment(
  deployments: DeploymentCandidate[],
  selectedEnvironment?: string,
): DeploymentLink {
  const eligible = deployments.filter((deployment) => {
    if (deployment.transient) return false
    const environment = deployment.latestStatus?.environment ?? deployment.environment
    if (selectedEnvironment) return environment.toLowerCase() === selectedEnvironment.toLowerCase()
    return deployment.productionEnvironment || environment.toLowerCase() === 'production'
  })
  const productionEnvironments = new Set(eligible.map((deployment) => (deployment.latestStatus?.environment ?? deployment.environment).toLowerCase()))
  if (!selectedEnvironment && productionEnvironments.size > 1) {
    return { url: null, environment: null, status: null, updatedAt: null, pending: false, error: 'Several production environments are available. Choose one to show its deployment.' }
  }
  const recent = [...eligible].sort((a, b) => activityTime(b) - activityTime(a) || b.id - a.id)[0]
  const successful = eligible
    .filter((deployment) => deployment.latestStatus?.state === 'success' && isSafeUrl(deployment.latestStatus.url))
    .sort((a, b) => statusTime(b) - statusTime(a) || b.id - a.id)[0]

  if (successful?.latestStatus) {
    const newer = recent?.latestStatus && statusTime(recent) > statusTime(successful)
      && ['pending', 'in_progress', 'failure', 'error'].includes(recent.latestStatus.state)
      ? `A newer deployment is ${recent.latestStatus.state}; this link is the latest successful deployment.`
      : null
    return {
      url: new URL(successful.latestStatus.url!).href,
      environment: successful.latestStatus.environment,
      status: 'success',
      updatedAt: successful.latestStatus.createdAt,
      pending: recent?.latestStatus?.state === 'pending' || recent?.latestStatus?.state === 'in_progress',
      error: newer,
    }
  }

  return {
    url: null,
    environment: recent?.latestStatus?.environment ?? selectedEnvironment ?? null,
    status: recent?.latestStatus?.state ?? null,
    updatedAt: recent?.latestStatus?.createdAt ?? recent?.createdAt ?? null,
    pending: recent?.latestStatus?.state === 'pending' || recent?.latestStatus?.state === 'in_progress',
    error: null,
  }
}

function activityTime(deployment: DeploymentCandidate): number {
  return Date.parse(deployment.latestStatus?.createdAt ?? deployment.createdAt) || 0
}

function statusTime(deployment: DeploymentCandidate): number {
  return Date.parse(deployment.latestStatus?.createdAt ?? '') || 0
}

function isSafeUrl(value: string | null): value is string {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}
