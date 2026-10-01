import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AccessStatusBadge, AssetCard, Button, EmptyState, EvidenceDrawer, FreshnessLabel, Tag, UnknownFact, useToast } from '../components'
import { buildComparisonMatrix, type ComparisonCell, type ComparisonDimension } from '../features'
import { evidenceById, projectById, projects, prototypeScenarioFromParams, reusableAssets } from '../mocks'
import { useAppState } from '../state'
import { comparisonSessionId, type Project, type ProjectId, type ReusableAsset } from '../types'

function projectName(projectId: ProjectId) {
  const project = projectById.get(projectId)
  if (!project) return '已删除作品'
  const name = project.currentName
  return name?.state === 'known' ? name.value : '名称未知的作品'
}

function useMobileComparison() {
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width: 48rem)')
    const update = () => setMobile(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return mobile
}

function ComparisonCellView({ cell }: { cell: ComparisonCell }) {
  const cellEvidences = cell.evidenceIds.map((id) => evidenceById.get(id)).filter((evidence) => evidence !== undefined)
  return (
    <div className={`comparison-cell${cell.prominent ? ' comparison-cell--prominent' : ''}${cell.freshness === 'expired' ? ' comparison-cell--expired' : ''}`}>
      {cell.state === 'unknown'
        ? <UnknownFact reason={cell.reason ?? '当前字段未核验'} />
        : cell.lines.length > 1
          ? <ul>{cell.lines.map((line) => <li key={line}>{line}</li>)}</ul>
          : <p>{cell.lines[0] ?? '暂无'}</p>}
      <FreshnessLabel status={cell.freshness} lastVerifiedAt={cell.lastVerifiedAt} />
      <EvidenceDrawer label="展开来源" evidences={cellEvidences} />
    </div>
  )
}

function ComparisonSummary({ dimensions, selectedProjects, selectedAssets, onRevealDetails }: { dimensions: ComparisonDimension[]; selectedProjects: Project[]; selectedAssets: ReusableAsset[]; onRevealDetails: () => void }) {
  const differences = dimensions.flatMap((dimension) => dimension.rows.filter((row) => !row.isSame).map((row) => ({ dimension: dimension.label, row })))
  const unknownCount = dimensions.flatMap((dimension) => dimension.rows).flatMap((row) => row.cells).filter((cell) => cell.state === 'unknown').length
  const riskProjects = selectedProjects.filter((project) => project.freshnessStatus === 'expired' || (project.accessStatus.state === 'known' && !['normal', 'recovered'].includes(project.accessStatus.value)))
  const availableAssets = selectedAssets.filter((asset) => asset.availabilityStatus === 'available')

  return (
    <section className="comparison-summary stack" aria-labelledby="comparison-summary-heading">
      <div className="section-heading cluster cluster--between"><div><p className="eyebrow">先看所选作品的主要差异</p><h3 id="comparison-summary-heading">关键差异摘要</h3><p>摘要只基于当前选择的作品，不要求提交额外判断。</p></div><button className="button" type="button" aria-controls="comparison-detail-matrix" onClick={onRevealDetails}>查看完整字段</button></div>
      <ol className="comparison-key-differences">
        {differences.slice(0, 3).map(({ dimension, row }) => <li key={`${dimension}-${row.id}`}><span>{dimension}</span><strong>{row.label}</strong><ul>{row.cells.map((cell) => <li key={cell.projectId}><b>{projectName(cell.projectId)}：</b>{cell.state === 'known' ? cell.lines.join('、') || '暂无' : `待确认，${cell.reason}`}</li>)}</ul></li>)}
      </ol>
      <div className="comparison-summary-signals">
        <section aria-labelledby="comparison-risk-heading"><h4 id="comparison-risk-heading">需要核对</h4>{riskProjects.length || unknownCount ? <ul>{riskProjects.map((project) => <li key={project.id}>{projectName(project.id)}：当前状态或资料时效需要注意</li>)}{unknownCount ? <li>{unknownCount} 个比较字段尚未确认，不能据此推断作品缺少该能力。</li> : null}</ul> : <p>当前没有过期状态或未知字段提醒。</p>}</section>
        <section aria-labelledby="comparison-reuse-heading"><h4 id="comparison-reuse-heading">可直接查看的资产</h4>{availableAssets.length ? <ul>{availableAssets.slice(0, 3).map((asset) => <li key={asset.id}><strong>{asset.name}</strong><span>{projectName(asset.projectId)} · {asset.license}</span></li>)}</ul> : <p>所选作品目前没有确认可获取的公开资产。</p>}<a href="#comparison-assets">查看全部资产</a></section>
      </div>
    </section>
  )
}

export function CompareSessionPage() {
  const { sessionId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { state, dispatch } = useAppState()
  const { pushToast } = useToast()
  const [replacementFor, setReplacementFor] = useState<ProjectId | null>(null)
  const [comparisonView, setComparisonView] = useState<'differences' | 'all'>('differences')
  const [mobileProjectId, setMobileProjectId] = useState<ProjectId | null>(null)
  const [selectionOpen, setSelectionOpen] = useState(false)
  const detailMatrixRef = useRef<HTMLDetailsElement>(null)
  const isMobileComparison = useMobileComparison()
  const routeSessionId = comparisonSessionId(sessionId)
  const session = state.comparisonSessions.find(({ id }) => id === routeSessionId)
  const selectedIds = prototypeScenarioFromParams(searchParams) === 'comparison_insufficient' ? session?.projectIds.slice(0, 1) ?? [] : session?.projectIds ?? []
  const candidates = projects.filter(({ id }) => !selectedIds.includes(id))
  const selectedProjects = selectedIds.map((id) => projectById.get(id)).filter((project) => project !== undefined)
  const missingProjectIds = selectedIds.filter((id) => !projectById.has(id))
  const selectedAssets = reusableAssets.filter(({ projectId }) => selectedIds.includes(projectId))
  const dimensions = buildComparisonMatrix(selectedProjects, selectedAssets)
  const comparisonCount = Math.max(selectedProjects.length, 2)
  const matrixStyle = { '--comparison-count': comparisonCount, '--comparison-min-width': `${10 + comparisonCount * 14}rem` } as CSSProperties

  const revealDetailMatrix = () => {
    const details = detailMatrixRef.current
    if (!details) return
    details.open = true
    const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    details.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    details.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true })
  }

  useEffect(() => {
    if (session && state.activeComparisonSessionId !== session.id) {
      dispatch({ type: 'COMPARISON_SESSION_RESTORE', sessionId: session.id })
    }
  }, [dispatch, session, state.activeComparisonSessionId])

  useEffect(() => {
    if (!mobileProjectId || !selectedProjects.some(({ id }) => id === mobileProjectId)) setMobileProjectId(selectedProjects[0]?.id ?? null)
  }, [mobileProjectId, selectedProjects])

  useEffect(() => {
    if (selectedProjects.length < 2) setSelectionOpen(true)
  }, [selectedProjects.length])

  function addCandidate(value: string) {
    if (!value) return
    dispatch({ type: 'COMPARISON_ADD', projectId: value as ProjectId })
  }

  function replaceCandidate(value: string) {
    if (!value || !replacementFor) return
    dispatch({ type: 'COMPARISON_REPLACE', removeId: replacementFor, addId: value as ProjectId })
    setReplacementFor(null)
    pushToast('已替换比较作品。', 'success')
  }

  function handleMobileProjectKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % selectedProjects.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + selectedProjects.length) % selectedProjects.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = selectedProjects.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const nextProject = selectedProjects[nextIndex]
    if (!nextProject) return
    setMobileProjectId(nextProject.id)
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')
    tabs?.[nextIndex]?.focus()
  }

  if (!session) {
    return (
      <main className="page-container page-with-bottom-space">
        <EmptyState
          title="比较会话不存在"
          description="这个会话可能已失效，或链接中的会话编号不正确。"
          action={<Link className="button button--primary" to="/projects">返回选择作品</Link>}
        />
      </main>
    )
  }

  const activeSessionId = session.id

  function saveComparison() {
    if (!state.session.user) {
      navigate(`/auth?return_to=${encodeURIComponent(`/compare/${activeSessionId}#structured-comparison-heading`)}`)
      return
    }
    dispatch({ type: 'COMPARISON_SESSION_SAVE' })
    pushToast('比较会话已保存。', 'success')
  }

  return (
    <main className="page-container page-with-bottom-space stack">
      <nav aria-label="面包屑"><Link to={session.sourcePath}>来源页</Link> / 比较会话</nav>
      <header className="comparison-session-hero stack stack--small">
        <div className="cluster cluster--between">
          <div>
            <h1>比较会话</h1>
            <p>{selectedIds.length >= 2 ? `正在比较 ${selectedIds.length} 个作品，先查看差异，需要时再调整作品。` : '选择 2–5 个作品后即可查看结构化差异。'}</p>
          </div>
          <Tag tone={selectedIds.length >= 2 ? 'strong' : 'dashed'}>{selectedIds.length}/5 个作品</Tag>
        </div>
        <dl className="comparison-session-meta">
          <div><dt>保存方式</dt><dd>{session.ownerUserId ? '当前链接可继续访问' : '仅在当前浏览器暂存'}</dd></div>
          <div><dt>会话状态</dt><dd>{session.ownerUserId ? session.savedAt ? `已保存 · ${new Date(session.savedAt).toLocaleString('zh-CN')}` : '登录账户 · 尚未保存' : '临时会话 · 尚未保存'}</dd></div>
          <div><dt>归属</dt><dd>{session.ownerUserId ? '登录账户' : '当前浏览器'}</dd></div>
        </dl>
      </header>

      <details className="comparison-selection-panel" open={selectionOpen} onToggle={(event) => setSelectionOpen(event.currentTarget.open)}>
        <summary><strong>管理比较作品</strong><span>{selectedIds.length}/5 个作品 · 调整顺序、替换或移除</span></summary>
      <section className="stack comparison-selection-panel__body" aria-labelledby="session-projects-heading">
        <div className="section-heading">
          <h2 id="session-projects-heading">管理比较作品</h2>
          <p>{selectedProjects.length >= 2 ? '作品已选好，可以开始比较。' : '至少选择两个可用作品后才能开始比较。'}</p>
        </div>
        <ol className="comparison-selection-list" aria-label="已选比较作品">
          {selectedIds.map((projectId, index) => (
            <li key={projectId} className="wire-card comparison-selection-item">
              <span className="comparison-selection-order" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <div className="stack stack--small">
                <strong>{projectName(projectId)}</strong>
                {projectById.has(projectId) ? <Link to={`/project/${projectId}`}>查看作品档案</Link> : <p className="unknown-value">原作品档案已删除或不可用；会话保留其位置，便于替换或移除。</p>}
              </div>
              <div className="cluster comparison-selection-actions">
                <Button variant="quiet" disabled={index === 0} aria-label={`上移${projectName(projectId)}`} onClick={() => dispatch({ type: 'COMPARISON_REORDER', projectId, direction: -1 })}>上移</Button>
                <Button variant="quiet" disabled={index === selectedIds.length - 1} aria-label={`下移${projectName(projectId)}`} onClick={() => dispatch({ type: 'COMPARISON_REORDER', projectId, direction: 1 })}>下移</Button>
                <Button variant="quiet" onClick={() => setReplacementFor(projectId)}>替换</Button>
                <Button variant="danger" onClick={() => dispatch({ type: 'COMPARISON_REMOVE', projectId })}>移除</Button>
              </div>
            </li>
          ))}
        </ol>

        {replacementFor ? (
          <div className="comparison-picker wire-card stack stack--small">
            <label htmlFor="replacement-project"><strong>替换“{projectName(replacementFor)}”</strong></label>
            <select id="replacement-project" defaultValue="" onChange={(event) => replaceCandidate(event.target.value)}>
              <option value="" disabled>选择替换作品</option>
              {candidates.map(({ id }) => <option key={id} value={id}>{projectName(id)}</option>)}
            </select>
            <Button variant="quiet" onClick={() => setReplacementFor(null)}>取消替换</Button>
          </div>
        ) : selectedIds.length < 5 ? (
          <div className="comparison-picker wire-card stack stack--small">
            <label htmlFor="additional-project"><strong>添加一个作品</strong></label>
            <select id="additional-project" value="" onChange={(event) => addCandidate(event.target.value)}>
              <option value="" disabled>选择一个作品</option>
              {candidates.map(({ id }) => <option key={id} value={id}>{projectName(id)}</option>)}
            </select>
          </div>
        ) : <p className="boundary-note">已达到 5 个作品上限；可先移除或替换一个作品。</p>}
        {missingProjectIds.length ? <aside className="boundary-note" role="note"><strong>有 {missingProjectIds.length} 个作品档案不可用</strong><p>它们不会参与字段比较，但不会从历史会话中自动消失。请在上方替换或移除。</p></aside> : null}
      </section>
      </details>

      {selectedProjects.length >= 2 ? (
        <section className="comparison-workspace stack" aria-labelledby="structured-comparison-heading">
          <div className="section-heading">
            <h2 id="structured-comparison-heading">结构化比较</h2>
            <p>逐项查看作品之间的差异，暂未确认或已经过期的信息会明确标出。</p>
          </div>
          <ComparisonSummary dimensions={dimensions} selectedProjects={selectedProjects} selectedAssets={selectedAssets} onRevealDetails={revealDetailMatrix} />
          <details ref={detailMatrixRef} id="comparison-detail-matrix" className="comparison-detail-matrix">
            <summary><strong>完整字段矩阵</strong><span>{dimensions.length} 个维度，按需展开</span></summary>
            <div className="comparison-detail-matrix__body stack">
          <div className="comparison-toolbar cluster cluster--between">
            <nav className="comparison-dimension-nav" aria-label="比较维度">
              {dimensions.map((dimension) => <a key={dimension.id} href={`#dimension-${dimension.id}`}>{dimension.label}</a>)}
            </nav>
            <div className="cluster" role="group" aria-label="比较显示范围">
              <Button variant={comparisonView === 'differences' ? 'primary' : 'quiet'} aria-pressed={comparisonView === 'differences'} onClick={() => setComparisonView('differences')}>仅看差异</Button>
              <Button variant={comparisonView === 'all' ? 'primary' : 'quiet'} aria-pressed={comparisonView === 'all'} onClick={() => setComparisonView('all')}>查看全部</Button>
            </div>
          </div>

          {isMobileComparison ? (
            <div className="mobile-comparison stack" aria-label={`${selectedProjects.length} 个作品的移动比较`}>
              <nav className="mobile-project-switch" aria-label="移动端作品切换" role="tablist">
                {selectedProjects.map((project, index) => <button id={`mobile-project-tab-${project.id}`} key={project.id} type="button" role="tab" aria-selected={mobileProjectId === project.id} aria-controls="mobile-comparison-panel" tabIndex={mobileProjectId === project.id ? 0 : -1} onClick={() => setMobileProjectId(project.id)} onKeyDown={(event) => handleMobileProjectKey(event, index)}>{projectName(project.id)}</button>)}
              </nav>
              <div id="mobile-comparison-panel" role="tabpanel" aria-label={mobileProjectId ? `${projectName(mobileProjectId)}的比较字段` : '比较字段'} className="stack">
                {dimensions.map((dimension) => {
                  const projectIndex = selectedProjects.findIndex(({ id }) => id === mobileProjectId)
                  const rows = comparisonView === 'differences' ? dimension.rows.filter(({ isSame }) => !isSame) : dimension.rows
                  return <section key={dimension.id} id={`mobile-dimension-${dimension.id}`} className="mobile-comparison-dimension stack stack--small"><h3>{dimension.label}</h3>{rows.length ? rows.map((row) => <article key={row.id} className="mobile-comparison-row stack stack--small"><div className="cluster cluster--between"><strong>{row.label}</strong>{row.isSame ? <Tag tone="dashed">各作品相同</Tag> : <Tag tone="strong">有差异</Tag>}</div>{row.cells[projectIndex] ? <ComparisonCellView cell={row.cells[projectIndex]} /> : <UnknownFact reason="作品档案不可用" />}</article>) : <p className="page-description">本维度没有差异；切换“查看全部”可查看相同项。</p>}</section>
                })}
              </div>
            </div>
          ) : <div className="comparison-matrix-scroll" tabIndex={0} aria-label={`${selectedProjects.length} 个作品的横向比较表`}>
            <div className="comparison-project-header" style={matrixStyle}>
              <strong>比较维度</strong>
              {selectedProjects.map((project) => {
                const accessStatus = project.accessStatus.state === 'known' ? project.accessStatus.value : 'unknown'
                const projectAssets = selectedAssets.filter(({ projectId }) => projectId === project.id)
                return (
                  <article key={project.id} className="comparison-project-column stack stack--small">
                    <span className="eyebrow">作品 {selectedIds.indexOf(project.id) + 1}</span>
                    <h3><Link to={`/project/${project.id}`}>{projectName(project.id)}</Link></h3>
                    <div className="cluster"><AccessStatusBadge status={accessStatus} /><Tag tone={project.freshnessStatus === 'expired' ? 'strong' : 'dashed'}>{project.freshnessStatus === 'expired' ? '资料已过期' : '资料已核验'}</Tag></div>
                    {['paused', 'ended', 'link_unavailable', 'partial_abnormal'].includes(accessStatus) ? <p className="comparison-status-warning">当前状态需注意；下方历史字段仍保留。</p> : null}
                    {projectAssets.length ? <a href="#comparison-assets">查看 {projectAssets.length} 项资产 ↓</a> : <span className="page-description">暂无公开资产</span>}
                  </article>
                )
              })}
            </div>

            {dimensions.map((dimension) => {
              const rows = comparisonView === 'differences' ? dimension.rows.filter(({ isSame }) => !isSame) : dimension.rows
              return (
                <section key={dimension.id} id={`dimension-${dimension.id}`} className="comparison-dimension stack stack--small" aria-labelledby={`dimension-${dimension.id}-heading`}>
                  <div className="comparison-dimension-title"><h3 id={`dimension-${dimension.id}-heading`}>{dimension.label}</h3></div>
                  {rows.length === 0 ? <p className="comparison-no-difference">本维度在所选作品中没有结构化差异；切换“查看全部”可展开相同项。</p> : rows.map((comparisonRow) => comparisonRow.isSame ? (
                    <details key={comparisonRow.id} className="comparison-same-row">
                      <summary>{comparisonRow.label} · 各作品相同，点击展开</summary>
                      <div className="comparison-row" style={matrixStyle}>
                        <strong>{comparisonRow.label}</strong>
                        {comparisonRow.cells.map((cell) => <ComparisonCellView key={cell.projectId} cell={cell} />)}
                      </div>
                    </details>
                  ) : (
                    <div key={comparisonRow.id} className="comparison-row comparison-row--different" style={matrixStyle}>
                      <strong>{comparisonRow.label}<Tag tone="strong">有差异</Tag></strong>
                      {comparisonRow.cells.map((cell) => <ComparisonCellView key={cell.projectId} cell={cell} />)}
                    </div>
                  ))}
                </section>
              )
            })}
          </div>}
            </div>
          </details>

          <section id="comparison-assets" className="stack" aria-labelledby="comparison-assets-heading">
            <div className="section-heading"><h3 id="comparison-assets-heading">可复用资产</h3><p>集中查看这些作品公开的代码、模板、组件和其他资源。</p></div>
            {selectedAssets.length ? <div className="card-grid">{selectedAssets.map((asset) => <AssetCard key={asset.id} asset={asset} projectName={projectName(asset.projectId)} />)}</div> : <EmptyState title="所选作品暂无公开资产" description="这不代表作品没有技术实现，只表示当前档案没有可获取资产。" />}
          </section>
        </section>
      ) : selectedIds.length === 0 ? <EmptyState title="还没有选择比较作品" description="请从作品广场、搜索或想法分析结果中加入 2–5 个作品。" action={<Link className="button button--primary" to="/projects">返回选择作品</Link>} /> : <EmptyState title="还不能开始比较" description={missingProjectIds.length ? '当前只有一个可用作品，请替换已删除作品或再添加一个。' : '当前只有一个作品，请再添加一个。'} action={<Link className="button button--primary" to="/projects">继续选择作品</Link>} />}

      <footer className="comparison-session-footer cluster cluster--between">
        <div className="cluster">
          <Button onClick={saveComparison}>{state.session.user ? '保存比较' : '登录并保存比较'}</Button>
          <Button variant="quiet" onClick={() => navigate(session.sourcePath)}>返回来源页</Button>
        </div>
        {selectedProjects.length >= 2
          ? <p role="status">当前仅比较你选择的 {selectedProjects.length} 个作品。</p>
          : <p role="status">还需添加 {2 - selectedProjects.length} 个有效作品。</p>}
      </footer>
    </main>
  )
}
