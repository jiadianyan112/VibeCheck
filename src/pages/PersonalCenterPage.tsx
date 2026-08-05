import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, Tag } from '../components'
import { buildPersonalCenterData, isStaffRole, publishedProjectFromSubmission, roleLabels, submissionReviewStatusLabels, verificationStatusLabels } from '../features'
import { projects } from '../mocks'
import { useAppState } from '../state'
import type { Project } from '../types'

const decisionActionLabels = { continue: '继续', adjust: '调整', reuse: '复用', pause: '暂停' } as const

function projectName(project: Project | undefined) {
  return project?.currentName.state === 'known' ? project.currentName.value : '名称未知作品'
}

function ProjectItems({ values, emptyTitle, emptyDescription, emptyTo, emptyAction }: { values: Project[]; emptyTitle: string; emptyDescription: string; emptyTo: string; emptyAction: string }) {
  return values.length ? <ul className="personal-item-list">{values.map((project) => <li key={project.id}><div><strong><Link to={`/project/${project.id}`}>{projectName(project)}</Link></strong><p>{project.oneLineDefinition.state === 'known' ? project.oneLineDefinition.value : '作品定义待补充。'}</p></div><Link className="button button--secondary" to={`/project/${project.id}`}>进入作品</Link></li>)}</ul> : <EmptyState title={emptyTitle} description={emptyDescription} action={<Link className="button button--secondary" to={emptyTo}>{emptyAction}</Link>} />
}

export function PersonalCenterPage() {
  const { state } = useAppState()
  const user = state.session.user
  const allProjects = useMemo(() => {
    const approved = state.submissionDrafts.map(publishedProjectFromSubmission).filter((project): project is Project => Boolean(project))
    const base = [...projects, ...approved]
    const baseIds = new Set(base.map((project) => project.id))
    return [...base.map((project) => state.projectOverrides.find((item) => item.id === project.id) ?? project), ...state.projectOverrides.filter((project) => !baseIds.has(project.id))]
  }, [state.projectOverrides, state.submissionDrafts])
  const data = useMemo(() => user ? buildPersonalCenterData(state, user, allProjects) : null, [allProjects, state, user])

  if (!user || !data) return null
  const activeComparisonPath = data.comparisonSessions[0] ? `/compare/${data.comparisonSessions[0].id}` : '/projects'
  const summaryCount = data.favoriteProjects.length + data.followedProjects.length + data.comparisonSessions.length + data.drafts.length + data.reviews.length

  return (
    <main className="page-container page-with-bottom-space stack">
      <header className="personal-summary">
        <div className="stack stack--small"><p className="eyebrow">Personal center</p><h1>{user.displayName}的个人中心</h1><div className="cluster"><Tag tone="strong">{roleLabels[state.session.role]}</Tag><span>{summaryCount} 项账户资产与创作记录</span></div></div>
        <div className="cluster"><Link className="button button--secondary" to="/auth?from=%2Fme">切换测试身份</Link>{user.creatorId ? <Link className="button button--primary" to={`/creator/${user.creatorId}`}>查看我的作者主页</Link> : null}{isStaffRole(state.session.role) ? <Link className="button button--primary" to="/admin">进入管理后台</Link> : null}</div>
      </header>

      <nav className="personal-section-nav" aria-label="个人资产导航">
        <a href="#favorites">收藏</a><a href="#follows">关注</a><a href="#comparisons">比较</a><a href="#recent">最近浏览</a><a href="#drafts">草稿</a><a href="#reviews">审核</a><a href="#decisions">决策</a><a href="#verification">身份验证</a>{user.creatorId ? <a href="#my-projects">我的作品</a> : null}
      </nav>

      <section id="favorites" className="personal-section stack" aria-labelledby="favorites-heading"><div className="section-heading"><p className="eyebrow">Saved</p><h2 id="favorites-heading">收藏</h2></div><ProjectItems values={data.favoriteProjects} emptyTitle="还没有收藏作品" emptyDescription="收藏用于稍后返回具体作品。" emptyTo="/projects" emptyAction="浏览作品广场" /></section>

      <section id="follows" className="personal-section stack" aria-labelledby="follows-heading"><div className="section-heading"><p className="eyebrow">Following updates</p><h2 id="follows-heading">关注的作品更新</h2></div><ProjectItems values={data.followedProjects} emptyTitle="还没有关注作品更新" emptyDescription="关注后，高价值作品更新会进入通知中心。" emptyTo="/activity" emptyAction="查看最新动态" /></section>

      <section id="comparisons" className="personal-section stack" aria-labelledby="comparisons-heading"><div className="section-heading"><p className="eyebrow">Comparisons</p><h2 id="comparisons-heading">比较记录</h2></div>{data.comparisonSessions.length ? <ul className="personal-item-list">{data.comparisonSessions.map((session) => <li key={session.id}><div><strong>{session.projectIds.length} 个作品的比较</strong><p>更新于 {new Date(session.updatedAt).toLocaleString('zh-CN')} · {session.savedAt ? '已保存' : '会话中'}</p></div><Link className="button button--primary" to={`/compare/${session.id}`}>继续比较</Link></li>)}</ul> : <EmptyState title="还没有账户比较记录" description="匿名比较会在登录时合并；保存后出现在这里。" action={<Link className="button button--secondary" to="/projects">选择作品比较</Link>} />}</section>

      <section id="recent" className="personal-section stack" aria-labelledby="recent-heading"><div className="section-heading"><p className="eyebrow">Recent</p><h2 id="recent-heading">最近浏览</h2></div><ProjectItems values={data.recentProjects} emptyTitle="暂无最近浏览" emptyDescription="进入作品详情后会在这里保留最近记录。" emptyTo="/projects" emptyAction="查看作品" /></section>

      <section id="drafts" className="personal-section stack" aria-labelledby="drafts-heading"><div className="section-heading"><p className="eyebrow">Drafts</p><h2 id="drafts-heading">发布草稿</h2></div>{data.drafts.length ? <ul className="personal-item-list">{data.drafts.map((draft) => <li key={draft.id}><div><strong>{draft.fields.currentName ?? '未命名草稿'}</strong><p>当前步骤：{draft.step} · 更新于 {new Date(draft.updatedAt).toLocaleString('zh-CN')}</p></div><Link className="button button--primary" to={`/submit/new?draft=${draft.id}&step=${draft.step}`}>恢复草稿</Link></li>)}</ul> : <EmptyState title="没有可编辑草稿" description="从公开作品地址开始创建一份发布草稿。" action={<Link className="button button--secondary" to="/submit">发布作品</Link>} />}</section>

      <section id="reviews" className="personal-section stack" aria-labelledby="reviews-heading"><div className="section-heading"><p className="eyebrow">Reviews</p><h2 id="reviews-heading">审核记录与意见</h2></div>{data.reviews.length ? <ul className="personal-item-list">{data.reviews.map((draft) => <li key={draft.id}><div><div className="cluster"><strong>{draft.fields.currentName ?? '未命名提交'}</strong><Tag tone={draft.status === 'approved' ? 'strong' : 'dashed'}>{submissionReviewStatusLabels[draft.status] ?? draft.status}</Tag></div>{Object.keys(draft.reviewMessages).length ? <ul>{Object.entries(draft.reviewMessages).map(([field, message]) => <li key={field}><strong>{field}</strong>：{message}</li>)}</ul> : <p>当前没有字段级审核意见。</p>}</div><Link className="button button--primary" to={`/submit/new?draft=${draft.id}`}>查看审核</Link></li>)}</ul> : <EmptyState title="暂无审核记录" description="提交发布草稿后，审核状态和字段意见会进入这里。" action={<Link className="button button--secondary" to="/submit">前往发布入口</Link>} />}</section>

      <section id="decisions" className="personal-section stack" aria-labelledby="decisions-heading"><div className="section-heading"><p className="eyebrow">Private decisions</p><h2 id="decisions-heading">比较决策</h2></div>{data.decisions.length ? <ul className="personal-item-list">{data.decisions.map((decision) => <li key={decision.id}><div><div className="cluster"><strong>{decisionActionLabels[decision.action]}</strong><Tag>仅自己可见</Tag></div><p>{decision.reason}</p></div><Link className="button button--secondary" to={`/compare/${decision.sessionId}#comparison-decision`}>返回比较</Link></li>)}</ul> : <EmptyState title="暂无私密比较决策" description="完成一次结构化比较后可记录下一步行动。" action={<Link className="button button--secondary" to={activeComparisonPath}>开始比较</Link>} />}</section>

      <section id="verification" className="personal-section stack" aria-labelledby="verification-heading"><div className="section-heading"><p className="eyebrow">Verification</p><h2 id="verification-heading">作者身份验证</h2></div>{data.verificationRequests.length ? <ul className="personal-item-list">{data.verificationRequests.map((request) => <li key={request.id}><div><div className="cluster"><strong>{projectName(allProjects.find(({ id }) => id === request.projectId))}</strong><Tag tone={request.status === 'verified' ? 'strong' : 'dashed'}>{verificationStatusLabels[request.status]}</Tag></div><p>{request.reviewMessage ?? '材料仅用于归属审核，不会公开展示。'}</p></div><Link className="button button--primary" to={`/project/${request.projectId}/verify-author`}>{request.status === 'draft' ? '继续身份材料' : '查看验证状态'}</Link></li>)}</ul> : <EmptyState title="暂无身份验证记录" description="如果你是已收录作品作者，可从作品详情申请关联。" action={<Link className="button button--secondary" to="/projects">寻找我的作品</Link>} />}</section>

      {user.creatorId ? <><section id="my-projects" className="personal-section stack" aria-labelledby="my-projects-heading"><div className="section-heading"><p className="eyebrow">Author works</p><h2 id="my-projects-heading">我的作品</h2></div>{data.myProjects.length ? <ul className="personal-item-list">{data.myProjects.map((project) => <li key={project.id}><div><strong><Link to={`/project/${project.id}`}>{projectName(project)}</Link></strong><p>作者归属已验证，可进入公开详情或管理更新。</p></div><div className="cluster"><Link className="button button--secondary" to={`/project/${project.id}`}>进入作品</Link><Link className="button button--primary" to={`/project/${project.id}/update`}>更新作品</Link></div></li>)}</ul> : <EmptyState title="暂无可管理作品" description="经验证关联后，作品会出现在这里。" action={<Link className="button button--secondary" to="/submit">发布或关联作品</Link>} />}</section><section id="update-tasks" className="personal-section stack" aria-labelledby="update-tasks-heading"><div className="section-heading"><p className="eyebrow">Update tasks</p><h2 id="update-tasks-heading">作品更新待办</h2></div>{data.myProjects.length ? <ul className="personal-item-list">{data.myProjects.map((project) => { const draft = data.updateDrafts.find((item) => item.projectId === project.id); return <li key={project.id}><div><strong>{projectName(project)}</strong><p>{draft ? `已有未完成更新；上次错误：${draft.lastErrorCode ?? '无'}` : `最近核验：${new Date(project.lastVerifiedAt).toLocaleDateString('zh-CN')}`}</p></div><Link className="button button--primary" to={`/project/${project.id}/update`}>{draft ? '继续更新' : '检查并更新'}</Link></li>})}</ul> : <EmptyState title="暂无作品更新待办" description="只有已验证关联的作者作品可以创建更新。" action={<Link className="button button--secondary" to={`/creator/${user.creatorId}`}>查看作者主页</Link>} />}</section></> : null}

      {isStaffRole(state.session.role) ? <section id="staff-tools" className="personal-section stack" aria-labelledby="staff-tools-heading"><div className="section-heading"><p className="eyebrow">Staff tools</p><h2 id="staff-tools-heading">平台管理入口</h2></div><div className="personal-management-grid"><Link className="wire-card stack stack--small" to="/admin/reviews"><strong>发布审核</strong><span>查看待审核与需修改提交</span></Link><Link className="wire-card stack stack--small" to="/admin/author-verification"><strong>作者身份审核</strong><span>复核归属材料与争议</span></Link><Link className="wire-card stack stack--small" to="/admin/status-monitor"><strong>状态监测</strong><span>处理作品状态异常</span></Link></div></section> : null}
    </main>
  )
}
