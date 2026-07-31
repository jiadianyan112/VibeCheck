import { useEffect, useState, type CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AccessStatusBadge, AssetCard, Button, EmptyState, EvidenceDrawer, FreshnessLabel, Tag, UnknownFact, useToast } from '../components'
import { buildComparisonMatrix, type ComparisonCell } from '../features'
import { evidenceById, projectById, projects, reusableAssets } from '../mocks'
import { useAppState } from '../state'
import { comparisonSessionId, type ProjectId } from '../types'

function projectName(projectId: ProjectId) {
  const name = projectById.get(projectId)?.currentName
  return name?.state === 'known' ? name.value : '名称未知的作品'
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

export function CompareSessionPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const { state, dispatch } = useAppState()
  const { pushToast } = useToast()
  const [replacementFor, setReplacementFor] = useState<ProjectId | null>(null)
  const [comparisonView, setComparisonView] = useState<'differences' | 'all'>('differences')
  const routeSessionId = comparisonSessionId(sessionId)
  const session = state.comparisonSessions.find(({ id }) => id === routeSessionId)
  const selectedIds = session?.projectIds ?? []
  const candidates = projects.filter(({ id }) => !selectedIds.includes(id))
  const selectedProjects = selectedIds.map((id) => projectById.get(id)).filter((project) => project !== undefined)
  const selectedAssets = reusableAssets.filter(({ projectId }) => selectedIds.includes(projectId))
  const dimensions = buildComparisonMatrix(selectedProjects, selectedAssets)
  const comparisonCount = Math.max(selectedProjects.length, 2)
  const matrixStyle = { '--comparison-count': comparisonCount, '--comparison-min-width': `${10 + comparisonCount * 14}rem` } as CSSProperties

  useEffect(() => {
    if (session && state.activeComparisonSessionId !== session.id) {
      dispatch({ type: 'COMPARISON_SESSION_RESTORE', sessionId: session.id })
    }
  }, [dispatch, session, state.activeComparisonSessionId])

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

  return (
    <main className="page-container page-with-bottom-space stack">
      <nav aria-label="面包屑"><Link to={session.sourcePath}>来源页</Link> / 比较会话</nav>
      <header className="comparison-session-hero stack stack--small">
        <p className="eyebrow">Comparison session</p>
        <div className="cluster cluster--between">
          <div>
            <h1>比较会话</h1>
            <p>先整理 2–5 个作品；当前排序会成为正式比较的列顺序。</p>
          </div>
          <Tag tone={selectedIds.length >= 2 ? 'strong' : 'dashed'}>{selectedIds.length}/5 个作品</Tag>
        </div>
        <dl className="comparison-session-meta">
          <div><dt>可分享路径</dt><dd><code>/compare/{session.id}</code></dd></div>
          <div><dt>保存状态</dt><dd>{session.savedAt ? `已保存 · ${new Date(session.savedAt).toLocaleString('zh-CN')}` : '仅保存在当前浏览器'}</dd></div>
          <div><dt>归属</dt><dd>{session.ownerUserId ? '登录账户' : '匿名本地会话'}</dd></div>
        </dl>
      </header>

      <section className="stack" aria-labelledby="session-projects-heading">
        <div className="section-heading">
          <p className="eyebrow">Selection</p>
          <h2 id="session-projects-heading">管理比较作品</h2>
          <p>{selectedIds.length >= 2 ? '已满足正式比较数量规则。' : '至少选择两个作品，才能进入正式比较。'}</p>
        </div>
        <ol className="comparison-selection-list" aria-label="已选比较作品">
          {selectedIds.map((projectId, index) => (
            <li key={projectId} className="wire-card comparison-selection-item">
              <span className="comparison-selection-order" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <div className="stack stack--small">
                <strong>{projectName(projectId)}</strong>
                <Link to={`/project/${projectId}`}>查看作品档案</Link>
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
              <option value="" disabled>从固定作品集中选择</option>
              {candidates.map(({ id }) => <option key={id} value={id}>{projectName(id)}</option>)}
            </select>
          </div>
        ) : <p className="boundary-note">已达到 5 个作品上限；可先移除或替换一个作品。</p>}
      </section>

      {selectedProjects.length >= 2 ? (
        <section className="comparison-workspace stack" aria-labelledby="structured-comparison-heading">
          <div className="section-heading">
            <p className="eyebrow">Structured comparison</p>
            <h2 id="structured-comparison-heading">结构化比较</h2>
            <p>按公开档案逐字段对照；“未知”与“过期”不会被空值替代，异常和结束状态也不会隐藏历史字段。</p>
          </div>

          <div className="comparison-toolbar cluster cluster--between">
            <nav className="comparison-dimension-nav" aria-label="比较维度">
              {dimensions.map((dimension) => <a key={dimension.id} href={`#dimension-${dimension.id}`}>{dimension.label}</a>)}
            </nav>
            <div className="cluster" role="group" aria-label="比较显示范围">
              <Button variant={comparisonView === 'differences' ? 'primary' : 'quiet'} aria-pressed={comparisonView === 'differences'} onClick={() => setComparisonView('differences')}>仅看差异</Button>
              <Button variant={comparisonView === 'all' ? 'primary' : 'quiet'} aria-pressed={comparisonView === 'all'} onClick={() => setComparisonView('all')}>查看全部</Button>
            </div>
          </div>

          <div className="comparison-matrix-scroll" tabIndex={0} aria-label={`${selectedProjects.length} 个作品的横向比较表`}>
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
                  <div className="comparison-dimension-title"><p className="eyebrow">Dimension</p><h3 id={`dimension-${dimension.id}-heading`}>{dimension.label}</h3></div>
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
          </div>

          <section id="comparison-assets" className="stack" aria-labelledby="comparison-assets-heading">
            <div className="section-heading"><p className="eyebrow">Reusable assets</p><h3 id="comparison-assets-heading">可复用资产快捷区</h3><p>资产状态、许可和价格独立于作品是否仍可访问。</p></div>
            {selectedAssets.length ? <div className="card-grid">{selectedAssets.map((asset) => <AssetCard key={asset.id} asset={asset} projectName={projectName(asset.projectId)} />)}</div> : <EmptyState title="所选作品暂无公开资产" description="这不代表作品没有技术实现，只表示当前档案没有可获取资产。" />}
          </section>
        </section>
      ) : null}

      <footer className="comparison-session-footer cluster cluster--between">
        <div className="cluster">
          <Button onClick={() => { dispatch({ type: 'COMPARISON_SESSION_SAVE' }); pushToast('比较会话已保存。', 'success') }}>保存比较</Button>
          <Button variant="quiet" onClick={() => navigate(session.sourcePath)}>返回来源页</Button>
        </div>
        {selectedIds.length >= 2
          ? <p><strong>下一步：</strong>基于比较结果记录继续、调整、复用或暂停。</p>
          : <p role="status">还需添加 {2 - selectedIds.length} 个作品。</p>}
      </footer>
    </main>
  )
}
