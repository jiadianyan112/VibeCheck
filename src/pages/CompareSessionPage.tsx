import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, EmptyState, Tag, useToast } from '../components'
import { projectById, projects } from '../mocks'
import { useAppState } from '../state'
import { comparisonSessionId, type ProjectId } from '../types'

function projectName(projectId: ProjectId) {
  const name = projectById.get(projectId)?.currentName
  return name?.state === 'known' ? name.value : '名称未知的作品'
}

export function CompareSessionPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const { state, dispatch } = useAppState()
  const { pushToast } = useToast()
  const [replacementFor, setReplacementFor] = useState<ProjectId | null>(null)
  const routeSessionId = comparisonSessionId(sessionId)
  const session = state.comparisonSessions.find(({ id }) => id === routeSessionId)
  const selectedIds = session?.projectIds ?? []
  const candidates = projects.filter(({ id }) => !selectedIds.includes(id))

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
        <ol className="comparison-selection-list">
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

      <footer className="comparison-session-footer cluster cluster--between">
        <div className="cluster">
          <Button onClick={() => { dispatch({ type: 'COMPARISON_SESSION_SAVE' }); pushToast('比较会话已保存。', 'success') }}>保存比较</Button>
          <Button variant="quiet" onClick={() => navigate(session.sourcePath)}>返回来源页</Button>
        </div>
        {selectedIds.length >= 2
          ? <p><strong>下一步：</strong>T33 将在此会话中呈现结构化比较。</p>
          : <p role="status">还需添加 {2 - selectedIds.length} 个作品。</p>}
      </footer>
    </main>
  )
}
