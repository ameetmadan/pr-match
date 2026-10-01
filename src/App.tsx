import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ConnectionSummary, DashboardMetrics, MergeOperation, Pin, PullRequest, PullRequestDetails, Repository, ReviewFilters } from './domain/types'
import { canMerge, evaluateCi } from './domain/filters'
import { demoMetrics, demoPullRequests, demoRepositories } from './demo/fixtures'
import { getDashboardMetrics, getPullRequestDetails, listRepositories, loadReviewQueue } from './github/service'
import { submitMerge } from './github/client'
import { loadSettings, saveSettings, listConnections, addConnection, removeConnection, pollMergeOperation, reconcileMergeOperation, listMergeOperations } from './storage/settings'
import type { AppSettings } from './storage/settings'

type Page = 'projects' | 'review' | 'settings'
type MetricMap = Record<number, DashboardMetrics>

export default function App() {
  const [page, setPage] = useState<Page>('projects')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [connections, setConnections] = useState<ConnectionSummary[]>([])
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [metrics, setMetrics] = useState<MetricMap>({})
  const [pulls, setPulls] = useState<PullRequest[]>([])
  const [details, setDetails] = useState<Record<number, PullRequestDetails>>({})
  const [mergeOperations, setMergeOperations] = useState<MergeOperation[]>([])
  const [skipped, setSkipped] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [token, setToken] = useState('')
  const [owner, setOwner] = useState('')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async (nextSettings?: AppSettings) => {
    const activeSettings = nextSettings ?? settings
    if (!activeSettings) return
    setLoading(true)
    try {
      const linked = await listConnections()
      setConnections(linked)
      if (activeSettings.demoMode) {
        setRepositories(demoRepositories)
        setPulls(demoPullRequests)
        setDetails(Object.fromEntries(demoPullRequests.map((item) => [item.id, item])))
        setMetrics(demoMetrics)
      } else {
        const repositoryPages = await Promise.all(linked.map((connection) => listRepositories(connection)))
        const allRepos = repositoryPages.flatMap((page) => page.value ?? [])
        setRepositories(allRepos)
        const queue = await loadReviewQueue(allRepos)
        setPulls(queue.pullRequests)
        if (queue.failedRepositories.length) setMessage(`Some repositories could not be refreshed: ${queue.failedRepositories.join(', ')}`)
        const pinnedRepos = activeSettings.pins.flatMap((pin) => {
          const repo = allRepos.find((item) => item.id === pin.repositoryId && item.connectionId === pin.connectionId)
          return repo ? [{ repo, pin }] : []
        })
        const metricPairs = await Promise.all(pinnedRepos.map(async ({ repo, pin }) => [repo.id, await getDashboardMetrics(repo, pin)] as const))
        setMetrics(Object.fromEntries(metricPairs))
        const operations = await listMergeOperations()
        const activeMerges = operations.filter(({ operation }) => ['pending', 'enqueued', 'submitting', 'unknown'].includes(operation.status))
        let mergedDuringReconcile = false
        for (const { key, operation } of activeMerges) {
          try {
            if (operation.status === 'pending' && operation.id) {
              const result = await pollMergeOperation(key, operation.id)
              if (result.status === 'merged') { setMessage('A pending GitHub merge completed successfully.'); mergedDuringReconcile = true }
            } else {
              const reconciled = await reconcileMergeOperation(key)
              if (reconciled.status === 'unknown' || reconciled.status === 'merged') setMessage(reconciled.message ?? `Merge status: ${reconciled.status}.`)
              if (reconciled.status === 'merged') mergedDuringReconcile = true
            }
          } catch { /* Keep the persisted operation for the next refresh. */ }
        }
        if (mergedDuringReconcile) {
          const refreshedQueue = await loadReviewQueue(allRepos)
          setPulls(refreshedQueue.pullRequests)
        }
        setMergeOperations((await listMergeOperations()).map(({ operation }) => operation))
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load GitHub data.')
    } finally { setLoading(false) }
  }, [settings])

  useEffect(() => {
    void (async () => {
      const loaded = await loadSettings()
      if (loaded.demoMode && loaded.pins.length === 0) {
        loaded.pins = demoRepositories.slice(0, 3).map((repo, order) => ({ repositoryId: repo.id, connectionId: repo.connectionId, owner: repo.owner, repository: repo.name, order }))
        await saveSettings(loaded)
      }
      setSettings(loaded)
      await refresh(loaded)
    })()
  }, [])

  useEffect(() => {
    const syncMergeOperations = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local' || !changes.mergeOperations) return
      const value = changes.mergeOperations.newValue as Record<string, MergeOperation> | undefined
      setMergeOperations(Object.values(value ?? {}))
    }
    chrome.storage.onChanged.addListener(syncMergeOperations)
    return () => chrome.storage.onChanged.removeListener(syncMergeOperations)
  }, [])

  const persist = async (next: AppSettings) => { setSettings(next); await saveSettings(next) }
  const pins = settings?.pins ?? []
  const matchingPulls = useMemo(() => pulls.filter((pull) => {
    const filters = settings?.filters
    if (!filters) return true
    if (filters.repositoryId !== null && pull.repositoryId !== filters.repositoryId) return false
    if (filters.authoredByMe && !connections.some((connection) => connection.userId === pull.authorId)) return false
    const detail = details[pull.id]
    if (filters.allCiPassing && detail && evaluateCi(detail.ciSignals, detail.ciComplete) !== 'passing') return false
    if (filters.linkedIssue && detail && (!detail.linkedIssuesKnown || detail.linkedIssues.length === 0)) return false
    if (filters.readyToMerge && detail && !mergeReady(detail)) return false
    return true
  }), [pulls, settings, details, connections])
  const visiblePulls = useMemo(() => matchingPulls.filter((pull) => !skipped.includes(pull.id)), [matchingPulls, skipped])
  const current = visiblePulls[0]
  const currentOperation = current ? mergeOperations.find((operation) => operation.repositoryId === current.repositoryId && operation.connectionId === current.connectionId && operation.pullNumber === current.number) : undefined
  const operationLocked = currentOperation ? ['submitting', 'pending', 'enqueued', 'unknown'].includes(currentOperation.status) : false

  useEffect(() => {
    if (!current || details[current.id]) return
    void getPullRequestDetails(current).then((value) => setDetails((existing) => ({ ...existing, [current.id]: value }))).catch((error: unknown) => {
      setDetails((existing) => ({ ...existing, [current.id]: { ...current, ciSignals: [], ciComplete: false, linkedIssues: [], linkedIssuesKnown: false } }))
      setMessage(error instanceof Error ? error.message : 'Could not load pull request checks.')
    })
  }, [current?.id, details])

  const skip = useCallback(() => { if (current && !busy && !operationLocked) setSkipped((items) => [...items, current.id]) }, [current, busy, operationLocked])
  const merge = useCallback(async () => {
    if (!current || !settings || settings.demoMode || busy || operationLocked) {
      if (settings?.demoMode) setMessage('Demo mode is read-only. Connect GitHub in Settings to merge a real pull request.')
      else if (operationLocked) setMessage(currentOperation?.message ?? 'This merge is unresolved. Refresh its status before moving to another pull request.')
      return
    }
    const detail = details[current.id]
    if (!detail || !eligible(detail, settings.filters)) { setMessage('This pull request does not meet the active merge filters.'); return }
    const selectedMethod = settings.pins.find((pin) => pin.repositoryId === current.repositoryId && pin.connectionId === current.connectionId)?.mergeMethod ?? settings.mergeMethod
    setBusy(true); setMessage('Checking the latest pull request state…')
    try {
      const result = await submitMerge({ connectionId: current.connectionId, repositoryId: current.repositoryId, owner: current.owner, repository: current.repository, pullNumber: current.number, headSha: current.headSha, baseBranch: current.baseBranch, method: selectedMethod, filters: { allCiPassing: settings.filters.allCiPassing, linkedIssue: settings.filters.linkedIssue } })
      setMergeOperations((await listMergeOperations()).map(({ operation }) => operation))
      setMessage(result.status === 'merged' ? 'Merged successfully.' : result.status === 'enqueued' ? 'GitHub queued this merge. It will stay out of the queue until reconciled.' : result.status === 'pending' ? 'GitHub is processing this merge.' : result.message ?? 'GitHub could not merge this pull request.')
      if (result.status === 'merged') { setSkipped((items) => [...items, current.id]); await refresh() }
      else if (result.status === 'pending' && result.uuid) {
        const key = `${current.connectionId}:${current.repositoryId}#${current.number}`
        const status = await pollMergeOperation(key, result.uuid)
        setMessage(status.status === 'merged' ? 'Merged successfully.' : status.message ?? `Merge status: ${status.status}.`)
        if (status.status === 'merged') { setSkipped((items) => [...items, current.id]); await refresh() }
        setMergeOperations((await listMergeOperations()).map(({ operation }) => operation))
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Merge status could not be confirmed. Refresh before retrying.')
      try { setMergeOperations((await listMergeOperations()).map(({ operation }) => operation)) } catch { /* Keep the current operation lock if storage is unavailable. */ }
    }
    finally { setBusy(false) }
  }, [current, settings, busy, details, refresh, operationLocked, currentOperation])

  useEffect(() => {
    if (page !== 'review') return
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || busy || operationLocked || event.altKey || event.ctrlKey || event.metaKey || (event.target instanceof Element && event.target.closest('button,a,input,textarea,select,summary,[contenteditable="true"],[role="button"]'))) return
      if (event.key === 'ArrowLeft') { event.preventDefault(); skip() }
      if (event.key === 'ArrowRight') { event.preventDefault(); void merge() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [page, skip, merge, busy, operationLocked])

  if (!settings) return <main className="splash">PR Match <span>Loading your workspace…</span></main>
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">↗</span><span>pr<span className="brand-light">match</span></span></div>
      <div className="workspace"><span className="avatar">{connections[0]?.login?.slice(0, 1).toUpperCase() ?? 'P'}</span><div><b>{connections[0]?.login ?? 'Your workspace'}</b><small>{settings.demoMode ? 'Sample workspace' : `${connections.length} GitHub connection${connections.length === 1 ? '' : 's'}`}</small></div><span className="dots">•••</span></div>
      <nav aria-label="Main navigation"><span className="nav-label">WORKSPACE</span>
        <button className={`nav-item ${page === 'projects' ? 'active' : ''}`} onClick={() => setPage('projects')}><i>▦</i> Projects <span>{pins.length}</span></button>
        <button className={`nav-item ${page === 'review' ? 'active' : ''}`} onClick={() => setPage('review')}><i>◈</i> Pull requests <span>{visiblePulls.length}</span></button>
        <span className="nav-label settings-label">PREFERENCES</span>
        <button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}><i>⚙</i> Settings</button>
      </nav>
      <div className="sidebar-bottom"><div className="mode-dot"/> {settings.demoMode ? 'Demo mode' : 'GitHub connected'}<button aria-label="Refresh data" title="Refresh data" onClick={() => void refresh()}>↻</button></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <b>{page === 'projects' ? 'Projects' : page === 'review' ? 'Pull requests' : 'Settings'}</b></div><div className="top-actions">{settings.demoMode && <span className="demo-badge">DEMO DATA</span>}<button className="icon-button" title="Refresh" onClick={() => void refresh()}>↻</button><button className="avatar small-avatar" onClick={() => setPage('settings')}>{connections[0]?.login?.slice(0, 1).toUpperCase() ?? 'P'}</button></div></header>
      {message && <div className="toast" role="status">{message}<button onClick={() => setMessage('')} aria-label="Dismiss">×</button></div>}
      {page === 'projects' && <ProjectsPage repositories={repositories} pins={pins} metrics={metrics} loading={loading} demo={settings.demoMode} onOpenReview={(repositoryId) => { if (repositoryId !== undefined) void persist({ ...settings, filters: { ...settings.filters, repositoryId } }); setPage('review') }} onReorder={(pin, offset) => {
        const ordered = [...pins].sort((a, b) => a.order - b.order)
        const index = ordered.findIndex((item) => item.repositoryId === pin.repositoryId && item.connectionId === pin.connectionId)
        const target = index + offset
        if (index < 0 || target < 0 || target >= ordered.length) return
        const selected = ordered[index]
        ordered[index] = ordered[target]
        ordered[target] = selected
        void persist({ ...settings, pins: ordered.map((item, order) => ({ ...item, order })) })
      }} onPin={async (repo) => {
        const exists = pins.some((pin) => pin.repositoryId === repo.id && pin.connectionId === repo.connectionId)
        const next = { ...settings, pins: exists ? pins.filter((pin) => pin.repositoryId !== repo.id || pin.connectionId !== repo.connectionId) : [...pins, { repositoryId: repo.id, connectionId: repo.connectionId, owner: repo.owner, repository: repo.name, order: pins.length }] }
        await persist(next); if (!next.demoMode) void getDashboardMetrics(repo, next.pins.find((pin) => pin.repositoryId === repo.id && pin.connectionId === repo.connectionId) ?? { repositoryId: repo.id, connectionId: repo.connectionId, owner: repo.owner, repository: repo.name, order: pins.length }).then((value) => setMetrics((items) => ({ ...items, [repo.id]: value })))
      }} onEditPin={async (pin, patch) => { const next = { ...settings, pins: pins.map((item) => item.repositoryId === pin.repositoryId && item.connectionId === pin.connectionId ? { ...item, ...patch } : item) }; await persist(next); if (!next.demoMode) void refresh(next) }} />}
      {page === 'review' && <ReviewPage current={current} detail={current ? details[current.id] : undefined} queueCount={visiblePulls.length} allCount={pulls.length} matchCount={matchingPulls.length} loading={loading} mergeMethod={settings.pins.find((pin) => pin.repositoryId === current?.repositoryId && pin.connectionId === current?.connectionId)?.mergeMethod ?? settings.mergeMethod} filters={settings.filters} repositories={repositories} busy={busy || operationLocked} demo={settings.demoMode} onFilters={async (filters) => persist({ ...settings, filters })} onSkip={skip} onResetSkipped={() => setSkipped([])} onMerge={() => void merge()} />}
      {page === 'settings' && <SettingsPage settings={settings} connections={connections} owner={owner} token={token} onOwner={setOwner} onToken={setToken} onAdd={async () => { try { const connection = await addConnection(token, owner); setToken(''); setSettings((old) => old ? { ...old, demoMode: false } : old); const next = { ...settings, demoMode: false }; await persist(next); setMessage(`Connected ${connection.owner} for ${connection.login}.`); await refresh(next) } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not connect GitHub.') } }} onRemove={async (id) => { await removeConnection(id); const left = await listConnections(); setConnections(left); setMessage('GitHub connection removed.') }} onDemo={async (demoMode) => { const next = { ...settings, demoMode }; await persist(next); await refresh(next) }} onMergeMethod={(mergeMethod) => void persist({ ...settings, mergeMethod })} />}
    </main>
  </div>
}

function ProjectsPage({ repositories, pins, metrics, loading, demo, onOpenReview, onReorder, onPin, onEditPin }: { repositories: Repository[]; pins: Pin[]; metrics: MetricMap; loading: boolean; demo: boolean; onOpenReview: (repositoryId?: number) => void; onReorder: (pin: Pin, offset: number) => void; onPin: (repo: Repository) => void; onEditPin: (pin: Pin, patch: Partial<Pin>) => void }) {
  const pinned = [...pins].sort((a, b) => a.order - b.order).flatMap((pin) => { const repo = repositories.find((item) => item.id === pin.repositoryId && item.connectionId === pin.connectionId); return repo ? [{ repo, pin }] : [] })
  return <section className="page-wrap"><div className="page-heading"><div><span className="eyebrow">YOUR WORK, AT A GLANCE</span><h1>Projects</h1><p>A clear view of what’s moving and what needs attention.</p></div><button className="primary-button" onClick={() => onOpenReview()}>Review pull requests <span>→</span></button></div>
    <div className="summary-strip"><div><b>{pinned.length.toString().padStart(2, '0')}</b><span>PINNED PROJECTS</span></div><div><b>{repositories.length}</b><span>REPOSITORIES</span></div><div><b>{repositories.reduce((total, repo) => total + (metrics[repo.id]?.mergedToday ?? 0), 0)}</b><span>MERGED TODAY</span></div><div className="strip-note"><span className="live-dot"/> {demo ? 'Example data · updates when you connect GitHub' : 'Your GitHub data · refreshed on demand'}</div></div>
    <div className="section-title"><div><h2>Pinned projects</h2><span>THE ONES YOU COME BACK TO</span></div><div className="select-wrap"><label htmlFor="pin-project">Add a project</label><select id="pin-project" value="" onChange={(event) => { const repo = repositories.find((item) => item.id === Number(event.target.value)); if (repo) onPin(repo) }}><option value="">Choose repository…</option>{repositories.filter((repo) => !pins.some((pin) => pin.repositoryId === repo.id && pin.connectionId === repo.connectionId)).map((repo) => <option key={`${repo.connectionId}-${repo.id}`} value={repo.id}>{repo.fullName}</option>)}</select></div></div>
    {loading && !repositories.length ? <div className="empty-state">Loading projects…</div> : pinned.length ? <div className="project-grid">{pinned.map(({ repo, pin }, index) => <ProjectCard key={`${repo.connectionId}-${repo.id}`} repo={repo} pin={pin} metrics={metrics[repo.id]} index={index} onEdit={onEditPin} onUnpin={() => onPin(repo)} onReview={() => onOpenReview(repo.id)} onMove={(offset) => onReorder(pin, offset)} canMoveUp={index > 0} canMoveDown={index < pinned.length - 1} />)}</div> : <div className="empty-state"><span className="empty-icon">▦</span><h3>No pinned projects yet</h3><p>Add a repository above to make this dashboard yours.</p></div>}
    <div className="below-fold"><span>ALL REPOSITORIES</span><b>{repositories.length} available</b><p>Pull requests from every connected repository appear in your review queue.</p></div>
  </section>
}

function ProjectCard({ repo, pin, metrics, index, onEdit, onUnpin, onReview, onMove, canMoveUp, canMoveDown }: { repo: Repository; pin: Pin; metrics?: DashboardMetrics; index: number; onEdit: (pin: Pin, patch: Partial<Pin>) => void; onUnpin: () => void; onReview: () => void; onMove: (offset: number) => void; canMoveUp: boolean; canMoveDown: boolean }) {
  const [environment, setEnvironment] = useState(pin.environment ?? '')
  useEffect(() => setEnvironment(pin.environment ?? ''), [pin.environment])
  const colors = ['mint', 'blue', 'peach', 'lavender']
  const deployment = metrics?.deployment
  return <article className="project-card"><div className={`card-cover ${colors[index % colors.length]}`}><div className="cover-orbit orbit-one"/><div className="cover-orbit orbit-two"/><div className="repo-monogram">{repo.name.slice(0, 1).toUpperCase()}</div><div className="cover-meta"><span>{repo.isPrivate ? 'PRIVATE' : 'PUBLIC'}</span><button onClick={onUnpin} title="Unpin project">•••</button></div></div>
    <div className="card-content"><div className="repo-title"><div><span className="repo-owner">{repo.owner} /</span><h3>{repo.name}</h3></div><a href={repo.htmlUrl} target="_blank" rel="noreferrer" aria-label="Open repository">↗</a></div><p className="repo-description">{repo.description || 'No description added yet.'}</p>
      <div className="metric-row"><div><b>{metrics?.mergedToday ?? '—'}</b><span>MERGED TODAY</span></div><div><b>{metrics?.openIssues ?? '—'}</b><span>OPEN ISSUES</span></div><div><b>{metrics?.openPullRequests ?? '—'}</b><span>OPEN PRS</span></div></div>
      <div className="deploy-row"><span className={`deploy-indicator ${deployment?.url ? 'success' : ''}`}/><div className="deploy-copy"><span>{deployment?.url ? 'LIVE DEPLOYMENT' : 'DEPLOYMENT'}</span>{deployment?.url ? <a href={deployment.url} target="_blank" rel="noreferrer">{new URL(deployment.url).host} ↗</a> : <small>{deployment?.pending ? 'Deployment in progress' : 'No production link found'}</small>}</div><label className="environment-field"><span>Environment</span><input aria-label={`${repo.name} deployment environment`} value={environment} onBlur={(event) => onEdit(pin, { environment: event.currentTarget.value.trim() || undefined })} onChange={(event) => setEnvironment(event.target.value)} placeholder="production" /></label></div>
      {deployment?.error && <div className="deployment-note">{deployment.error}</div>}
      <div className="card-footer"><button className="card-review" onClick={onReview}>Review this project’s PRs <span>→</span></button><div className="move-buttons"><button disabled={!canMoveUp} onClick={() => onMove(-1)} aria-label={`Move ${repo.name} up`}>↑</button><button disabled={!canMoveDown} onClick={() => onMove(1)} aria-label={`Move ${repo.name} down`}>↓</button></div></div>
      <details className="card-settings"><summary>Deployment link settings</summary><label>Override URL<input type="url" placeholder="https://your-site.com" value={pin.deploymentUrl ?? ''} onChange={(event) => onEdit(pin, { deploymentUrl: event.target.value || undefined })}/></label></details>
      <details className="card-settings"><summary>Merge method</summary><label>For this repository<select value={pin.mergeMethod ?? ''} onChange={(event) => onEdit(pin, { mergeMethod: (event.target.value || undefined) as Pin['mergeMethod'] })}><option value="">Use workspace default</option><option value="squash">Squash and merge</option><option value="merge">Merge commit</option><option value="rebase">Rebase and merge</option></select></label></details>
      {metrics?.stale && <div className="stale-note">Showing saved data · refreshed {timeAgo(metrics.fetchedAt)}</div>}
    </div>
  </article>
}

function ReviewPage({ current, detail, queueCount, allCount, matchCount, loading, mergeMethod, filters, repositories, busy, demo, onFilters, onSkip, onResetSkipped, onMerge }: { current?: PullRequest; detail?: PullRequestDetails; queueCount: number; allCount: number; matchCount: number; loading: boolean; mergeMethod: 'merge' | 'squash' | 'rebase'; filters: ReviewFilters; repositories: Repository[]; busy: boolean; demo: boolean; onFilters: (filters: ReviewFilters) => void; onSkip: () => void; onResetSkipped: () => void; onMerge: () => void }) {
  const ci = detail ? evaluateCi(detail.ciSignals, detail.ciComplete) : 'unknown'
  const ready = !!detail && eligible(detail, filters)
  return <section className="page-wrap review-wrap"><div className="page-heading review-heading"><div><span className="eyebrow">THE REVIEW QUEUE</span><h1>Pull requests</h1><p>One at a time. Keep the work moving.</p></div><div className="queue-count"><b>{queueCount.toString().padStart(2, '0')}</b><span>READY TO REVIEW</span></div></div>
    <div className="filter-bar"><div className="filter-label">FILTERS <span>↗</span></div><select disabled={busy} aria-label="Filter by repository" value={filters.repositoryId ?? ''} onChange={(event) => onFilters({ ...filters, repositoryId: event.target.value ? Number(event.target.value) : null })}><option value="">All repositories</option>{repositories.map((repo) => <option key={`${repo.connectionId}-${repo.id}`} value={repo.id}>{repo.fullName}</option>)}</select><FilterToggle label="CI passing" checked={filters.allCiPassing} disabled={busy} onChange={(allCiPassing) => onFilters({ ...filters, allCiPassing })}/><FilterToggle label="Linked issue" checked={filters.linkedIssue} disabled={busy} onChange={(linkedIssue) => onFilters({ ...filters, linkedIssue })}/><FilterToggle label="Ready to merge" checked={filters.readyToMerge} disabled={busy} onChange={(readyToMerge) => onFilters({ ...filters, readyToMerge })}/><FilterToggle label="By me" checked={filters.authoredByMe} disabled={busy} onChange={(authoredByMe) => onFilters({ ...filters, authoredByMe })}/></div>
    {current ? detail ? <div className="review-layout"><div className="pr-card"><div className="pr-card-top"><span className="repo-chip"><i/> {current.repositoryName}</span><span className="pr-number">#{current.number}</span><a href={current.htmlUrl} target="_blank" rel="noreferrer" title="Open on GitHub">↗</a></div><div className="pr-main"><span className="pr-state"><i/> OPEN PULL REQUEST</span><h2>{current.title}</h2><p>{current.body || 'No description provided.'}</p><div className="pr-author"><span className="avatar author-avatar">{current.author.slice(0, 1).toUpperCase()}</span><span><b>{current.author}</b><small>opened {timeAgo(current.createdAt)}</small></span><span className="branch-line">{current.headBranch} <span>→</span> {current.baseBranch}</span></div><div className="pr-stats"><div><b className="additions">+{current.additions}</b> additions</div><div><b className="deletions">−{current.deletions}</b> deletions</div><div><b>{current.changedFiles}</b> files changed</div></div></div><div className="pr-checks"><div className="check-heading"><b>Before you merge</b><span>{ready ? 'LOOKS GOOD' : 'NEEDS A LOOK'}</span></div><CheckRow label="All CI checks passing" value={ci === 'passing' ? 'Passed' : ci === 'pending' ? 'Running' : ci === 'failing' ? 'Failed' : ci === 'empty' ? 'No checks' : 'Unknown'} status={ci === 'passing' ? 'good' : ci === 'pending' ? 'wait' : 'bad'}/><CheckRow label="Linked issue" value={detail.linkedIssuesKnown ? detail.linkedIssues.length ? `#${detail.linkedIssues[0].number} · ${detail.linkedIssues[0].title}` : 'None linked' : 'Unknown'} status={detail.linkedIssuesKnown && detail.linkedIssues.length ? 'good' : 'wait'} href={detail.linkedIssues[0]?.url}/><CheckRow label="Merge readiness" value={current.draft ? 'Draft pull request' : current.mergeable === false ? 'Has conflicts' : current.mergeableState === 'clean' ? 'Ready to merge' : current.mergeableState ?? 'Unknown'} status={ready ? 'good' : 'bad'}/>{detail.reviewDecision && <CheckRow label="Review decision" value={detail.reviewDecision.replaceAll('_', ' ').toLowerCase()} status={detail.reviewDecision === 'APPROVED' ? 'good' : 'wait'}/>}</div></div><aside className="queue-rail"><div className="rail-position"><span>UP NEXT</span><b>{Math.max(0, queueCount - 1).toString().padStart(2, '0')}</b><small>of {allCount} pull requests</small></div><div className="rail-key"><kbd>←</kbd><span>Skip this one</span></div><div className="rail-key"><kbd>→</kbd><span>Merge when ready</span></div><div className="shortcut-hint">Arrow keys work anywhere on this page.</div></aside></div> : <div className="pr-loading" role="status">Loading pull request checks and linked issues…</div> : loading ? <div className="pr-loading" role="status">Loading open pull requests…</div> : <div className="empty-state review-empty"><span className="empty-icon">✓</span><h3>{matchCount === 0 && allCount ? 'No pull requests match these filters' : matchCount ? 'You reviewed every matching pull request' : 'Queue is clear'}</h3><p>{matchCount === 0 && allCount ? 'Adjust the filters to see more of your open pull requests.' : matchCount ? 'Start over to review the skipped pull requests again.' : 'Every open pull request across your repositories will appear here.'}</p>{matchCount ? <button className="text-button" onClick={onResetSkipped}>Review skipped PRs again</button> : allCount > 0 && <button className="text-button" onClick={() => onFilters({ repositoryId: null, authoredByMe: false, allCiPassing: false, linkedIssue: false, readyToMerge: false })}>Clear filters</button>}</div>}
    <div className="review-actions"><button className="skip-button" disabled={!current || busy} onClick={onSkip}><kbd>←</kbd> Skip</button><span>{demo ? 'Demo mode · merges are disabled' : 'Merge respects repository rules'}</span><button className="merge-button" disabled={!current || !ready || busy || demo} onClick={onMerge}>{busy ? 'Checking…' : `Merge · ${mergeMethod}`} <kbd>→</kbd></button></div>
  </section>
}

function SettingsPage({ settings, connections, owner, token, onOwner, onToken, onAdd, onRemove, onDemo, onMergeMethod }: { settings: AppSettings; connections: ConnectionSummary[]; owner: string; token: string; onOwner: (value: string) => void; onToken: (value: string) => void; onAdd: () => void; onRemove: (id: string) => void; onDemo: (value: boolean) => void; onMergeMethod: (value: AppSettings['mergeMethod']) => void }) {
  return <section className="page-wrap settings-wrap"><div className="page-heading"><div><span className="eyebrow">MAKE IT YOURS</span><h1>Settings</h1><p>Connect your repositories and choose how PR Match behaves.</p></div></div><div className="settings-grid"><div className="settings-main"><section className="settings-panel"><div className="settings-panel-heading"><div><span className="settings-icon">⌘</span><div><h2>GitHub connections</h2><p>Connect an account or organization to load its repositories.</p></div></div><span className={`connection-status ${settings.demoMode ? '' : 'connected'}`}>{settings.demoMode ? 'DEMO' : 'CONNECTED'}</span></div><div className="connection-form"><label>Account or organization<input autoComplete="off" placeholder="e.g. octo-org" value={owner} onChange={(event) => onOwner(event.target.value)}/></label><label>Fine-grained personal access token<input type="password" autoComplete="new-password" placeholder="github_pat_…" value={token} onChange={(event) => onToken(event.target.value)}/></label><button className="primary-button" disabled={!owner || !token} onClick={onAdd}>Connect GitHub <span>→</span></button></div>{connections.map((connection) => <div className="connection-row" key={connection.id}><span className="avatar">{connection.login.slice(0, 1).toUpperCase()}</span><div><b>{connection.owner}</b><small>Connected as @{connection.login}</small></div><button className="danger-link" onClick={() => onRemove(connection.id)}>Remove</button></div>)}</section><section className="settings-panel"><div className="settings-panel-heading"><div><span className="settings-icon">↗</span><div><h2>Review preferences</h2><p>Choose the merge strategy sent to GitHub.</p></div></div></div><label className="field-label">Default merge method<select value={settings.mergeMethod} onChange={(event) => onMergeMethod(event.target.value as AppSettings['mergeMethod'])}><option value="squash">Squash and merge</option><option value="merge">Create a merge commit</option><option value="rebase">Rebase and merge</option></select></label></section></div><aside className="settings-aside"><div className="settings-panel demo-panel"><span className="eyebrow">SAFE TO EXPLORE</span><h2>Try the sample workspace</h2><p>Explore project cards and the review queue with clearly labeled example data.</p><button className={settings.demoMode ? 'secondary-button selected' : 'secondary-button'} onClick={() => onDemo(!settings.demoMode)}>{settings.demoMode ? 'Demo mode is on' : 'Switch to demo mode'}</button><small>Demo mode never contacts GitHub or merges pull requests.</small></div><div className="permissions-note"><b>Token permissions</b><p>Read access to metadata, pull requests, issues, checks, commit statuses, and deployments. Pull requests: write is needed only to merge.</p><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Create a fine-grained token ↗</a></div></aside></div></section>
}

function FilterToggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) { return <label className={`filter-toggle ${checked ? 'selected' : ''}`}><input type="checkbox" disabled={disabled} checked={checked} onChange={(event) => onChange(event.target.checked)}/><span>{checked && '✓'}</span>{label}</label> }
function CheckRow({ label, value, status, href }: { label: string; value: string; status: 'good' | 'bad' | 'wait'; href?: string }) { return <div className="check-row"><span className={`check-mark ${status}`}>{status === 'good' ? '✓' : status === 'wait' ? '·' : '!'}</span><span>{label}</span>{href ? <a href={href} target="_blank" rel="noreferrer">{value} ↗</a> : <b>{value}</b>}</div> }
function mergeReady(detail: PullRequestDetails): boolean { return detail.state === 'open' && !detail.draft && detail.mergeable === true && detail.mergeableState === 'clean' && detail.headSha.length === 40 }
function eligible(detail: PullRequestDetails, filters: ReviewFilters): boolean {
  return canMerge({ open: detail.state === 'open', draft: detail.draft, mergeReady: mergeReady(detail), ci: evaluateCi(detail.ciSignals, detail.ciComplete), hasLinkedIssue: detail.linkedIssuesKnown ? detail.linkedIssues.length > 0 : null }, filters)
}
function timeAgo(value: string): string { const minutes = Math.max(1, Math.floor((Date.now() - Date.parse(value)) / 60000)); if (minutes < 60) return `${minutes}m ago`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h ago`; return `${Math.floor(hours / 24)}d ago` }
