import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Button, EmptyState, Tag } from '../components'
import { buildPersonalCenterData, isStaffRole, publishedProjectFromSubmission, roleLabels, submissionReviewStatusLabels, verificationStatusLabels } from '../features'
import { projects } from '../mocks'
import { useAppState } from '../state'
import type { Project } from '../types'

const decisionActionLabels = { continue: '继续', adjust: '调整', reuse: '复用', pause: '暂停' } as const

function projectName(project: Project | undefined) {
  return project?.currentName.state === 'known' ? project.currentName.value : '名称未知作品'
}

function ProjectItems({ values, followedProjectIds = [], onToggleFollow, emptyTitle, emptyDescription, emptyTo, emptyAction }: { values: Project[]; followedProjectIds?: readonly Project['id'][]; onToggleFollow?: (project: Project) => void; emptyTitle: string; emptyDescription: string; emptyTo: string; emptyAction: string }) {
  return values.length ? <ul className="personal-item-list">{values.map((project) => { const followed = followedProjectIds.includes(project.id); return <li key={project.id}><div><strong><Link to={`/project/${project.id}`}>{projectName(project)}</Link></strong><p>{project.oneLineDefinition.state === 'known' ? project.oneLineDefinition.value : '作品定义待补充。'}</p></div><div className="cluster">{onToggleFollow ? <Button aria-pressed={followed} onClick={() => onToggleFollow(project)}>{followed ? '取消关注更新' : '关注更新'}</Button> : null}<Link className="button button--secondary" to={`/project/${project.id}`}>进入作品</Link></div></li> })}</ul> : <EmptyState title={emptyTitle} description={emptyDescription} action={<Link className="button button--secondary" to={emptyTo}>{emptyAction}</Link>} />
}

export function PersonalCenterPage() {
  const { state, dispatch } = useAppState()
  const user = state.session.user
  const allProjects = useMemo(() => {
    const approved = state.submissionDrafts.map(publishedProjectFromSubmission).filter((project): project is Project => Boolean(project))
    const base = [...projects, ...approved]
    const baseIds = new Set(base.map((project) => project.id))
    return [...base.map((project) => state.projectOverrides.find((item) => item.id === project.id) ?? project), ...state.projectOverrides.filter((project) => !baseIds.has(project.id))]
  }, [state.projectOverrides, state.submissionDrafts])
  const data = useMemo(() => user ? buildPersonalCenterData(state, user, allProjects) : null, [allProjects, state, user])

  if (!user || !data) return null
  const activeComparisonPath = data.comparisonSessions[0]
    ? `/compare/${data.comparisonSessions[0].id}${data.comparisonSessions[0].projectIds.length >= 2 ? '#structured-comparison-heading' : ''}`
    : '/projects'
  const summaryCount = data.favoriteProjects.length + data.comparisonSessions.length + data.drafts.length + data.reviews.length

  return (
    <main className="page-container page-with-bottom-space stack">
      <header className="personal-summary">
        <div className="stack stack--small"><h1>{user.displayName}的个人中心</h1><div className="cluster"><Tag tone="strong">{roleLabels[state.session.role]}</Tag><span>{summaryCount} 项收藏、草稿和创作记录</span></div></div>
        <div className="cluster"><Link className="button button--secondary" to="/auth?from=%2Fme">切换账号</Link>{user.creatorId ? <Link className="button button--primary" to={`/creator/${user.creatorId}`}>查看我的作者主页</Link> : null}{isStaffRole(state.session.role) ? <Link className="button button--primary" to="/admin">进入管理后台</Link> : null}</div>
      </header>

      <nav className="personal-section-nav" aria-label="个人资产导航">
        <a href="#favorites">收藏</a><a href="#comparisons">比较</a><a href="#recent">最近浏览</a><a href="#drafts">草稿</a><a href="#reviews">审核</a><a href="#decisions">决策</a><a href="#verification">身份验证</a>{user.creatorId ? <a href="#my-projects">我的作品</a> : null}
      </nav>

      <section id="favorites" className="personal-section stack" aria-labelledby="favorites-heading"><div className="section-heading"><h2 id="favorites-heading">收藏</h2><p>在这里选择需要关注更新的作品，新版本或状态变化会进入通知。</p></div><ProjectItems values={data.favoriteProjects} followedProjectIds={state.followedProjectIds} onToggleFollow={(project) => dispatch({ type: 'FOLLOW_TOGGLE', projectId: project.id })} emptyTitle="还没有收藏作品" emptyDescription="收藏后可以从这里快速返回作品，并按需关注更新。" emptyTo="/projects" emptyAction="浏览作品广场" /></section>

      <section id="comparisons" className="personal-section stack" aria-labelledby="comparisons-heading"><div className="section-heading"><h2 id="comparisons-heading">比较记录</h2></div>{data.comparisonSessions.length ? <ul className="personal-item-list">{data.comparisonSessions.map((session) => <li key={session.id}><div><strong>{session.projectIds.length} 个作品的比较</strong><p>更新于 {new Date(session.updatedAt).toLocaleString('zh-CN')} · {session.savedAt ? '已保存' : '会话中'}</p></div><Link className="button button--primary" to={`/compare/${session.id}${session.projectIds.length >= 2 ? '#structured-comparison-heading' : ''}`}>继续比较</Link></li>)}</ul> : <EmptyState title="还没有比较记录" description="选择两个或更多作品，就可以逐项查看差异。" action={<Link className="button button--secondary" to="/projects">选择作品比较</Link>} />}</section>

      <section id="recent" className="personal-section stack" aria-labelledby="recent-heading"><div className="section-heading"><h2 id="recent-heading">最近浏览</h2></div><ProjectItems values={data.recentProjects} emptyTitle="暂无最近浏览" emptyDescription="浏览作品详情后，可以从这里快速返回。" emptyTo="/projects" emptyAction="查看作品" /></section>

      <section id="drafts" className="personal-section stack" aria-labelledby="drafts-heading"><div className="section-heading"><h2 id="drafts-heading">发布草稿</h2></div>{data.drafts.length ? <ul className="personal-item-list">{data.drafts.map((draft) => <li key={draft.id}><div><strong>{draft.fields.currentName ?? '未命名草稿'}</strong><p>更新于 {new Date(draft.updatedAt).toLocaleString('zh-CN')}</p></div><Link className="button button--primary" to={`/submit/new?draft=${draft.id}&step=${draft.step}`}>继续编辑</Link></li>)}</ul> : <EmptyState title="没有可编辑草稿" description="从公开作品地址开始创建一份发布草稿。" action={<Link className="button button--secondary" to="/submit">发布作品</Link>} />}</section>

      <section id="reviews" className="personal-section stack" aria-labelledby="reviews-heading"><div className="section-heading"><h2 id="reviews-heading">审核记录与意见</h2></div>{data.reviews.length ? <ul className="personal-item-list">{data.reviews.map((draft) => <li key={draft.id}><div><div className="cluster"><strong>{draft.fields.currentName ?? '未命名提交'}</strong><Tag tone={draft.status === 'approved' ? 'strong' : 'dashed'}>{submissionReviewStatusLabels[draft.status] ?? draft.status}</Tag></div>{Object.keys(draft.reviewMessages).length ? <ul>{Object.entries(draft.reviewMessages).map(([field, message]) => <li key={field}>{message}</li>)}</ul> : <p>当前没有需要修改的内容。</p>}</div><Link className="button button--primary" to={`/submit/new?draft=${draft.id}`}>查看审核</Link></li>)}</ul> : <EmptyState title="暂无审核记录" description="提交作品后，可以从这里查看进度和修改意见。" action={<Link className="button button--secondary" to="/submit">前往发布入口</Link>} />}</section>

      <section id="decisions" className="personal-section stack" aria-labelledby="decisions-heading"><div className="section-heading"><h2 id="decisions-heading">比较决策</h2></div>{data.decisions.length ? <ul className="personal-item-list">{data.decisions.map((decision) => <li key={decision.id}><div><div className="cluster"><strong>{decisionActionLabels[decision.action]}</strong><Tag>仅自己可见</Tag></div><p>{decision.reason}</p></div><Link className="button button--secondary" to={`/compare/${decision.sessionId}#comparison-decision`}>返回比较</Link></li>)}</ul> : <EmptyState title="暂无比较决策" description="完成作品比较后，可以记录下一步行动。" action={<Link className="button button--secondary" to={activeComparisonPath}>开始比较</Link>} />}</section>

      <section id="verification" className="personal-section stack" aria-labelledby="verification-heading"><div className="section-heading"><h2 id="verification-heading">作者身份验证</h2></div>{data.verificationRequests.length ? <ul className="personal-item-list">{data.verificationRequests.map((request) => <li key={request.id}><div><div className="cluster"><strong>{projectName(allProjects.find(({ id }) => id === request.projectId))}</strong><Tag tone={request.status === 'verified' ? 'strong' : 'dashed'}>{verificationStatusLabels[request.status]}</Tag></div><p>{request.reviewMessage ?? '材料仅用于归属审核，不会公开展示。'}</p></div><Link className="button button--primary" to={`/project/${request.projectId}/verify-author`}>{request.status === 'draft' ? '继续身份材料' : '查看验证状态'}</Link></li>)}</ul> : <EmptyState title="暂无身份验证记录" description="如果你是已收录作品作者，可从作品详情申请关联。" action={<Link className="button button--secondary" to="/projects">寻找我的作品</Link>} />}</section>

      {user.creatorId ? <><section id="my-projects" className="personal-section stack" aria-labelledby="my-projects-heading"><div className="section-heading"><h2 id="my-projects-heading">我的作品</h2></div>{data.myProjects.length ? <ul className="personal-item-list">{data.myProjects.map((project) => <li key={project.id}><div><strong><Link to={`/project/${project.id}`}>{projectName(project)}</Link></strong><p>作者身份已确认，你可以查看详情或发布更新。</p></div><div className="cluster"><Link className="button button--secondary" to={`/project/${project.id}`}>进入作品</Link><Link className="button button--primary" to={`/project/${project.id}/update`}>更新作品</Link></div></li>)}</ul> : <EmptyState title="暂无可管理作品" description="完成作者身份验证后，作品会出现在这里。" action={<Link className="button button--secondary" to="/submit">发布或关联作品</Link>} />}</section><section id="update-tasks" className="personal-section stack" aria-labelledby="update-tasks-heading"><div className="section-heading"><h2 id="update-tasks-heading">作品更新待办</h2></div>{data.myProjects.length ? <ul className="personal-item-list">{data.myProjects.map((project) => { const draft = data.updateDrafts.find((item) => item.projectId === project.id); return <li key={project.id}><div><strong>{projectName(project)}</strong><p>{draft ? '有一项未完成的更新，可以继续编辑。' : `最近核验：${new Date(project.lastVerifiedAt).toLocaleDateString('zh-CN')}`}</p></div><Link className="button button--primary" to={`/project/${project.id}/update`}>{draft ? '继续更新' : '检查并更新'}</Link></li>})}</ul> : <EmptyState title="暂无作品更新待办" description="完成作者身份验证后即可发布作品更新。" action={<Link className="button button--secondary" to={`/creator/${user.creatorId}`}>查看作者主页</Link>} />}</section></> : null}

      {isStaffRole(state.session.role) ? <section id="staff-tools" className="personal-section stack" aria-labelledby="staff-tools-heading"><div className="section-heading"><h2 id="staff-tools-heading">平台管理入口</h2></div><div className="personal-management-grid"><Link className="wire-card stack stack--small" to="/admin/reviews"><strong>发布审核</strong><span>查看待审核与需修改提交</span></Link><Link className="wire-card stack stack--small" to="/admin/author-verification"><strong>作者身份审核</strong><span>复核归属材料与争议</span></Link><Link className="wire-card stack stack--small" to="/admin/status-monitor"><strong>状态监测</strong><span>处理作品状态异常</span></Link></div></section> : null}
    </main>
  )
}
