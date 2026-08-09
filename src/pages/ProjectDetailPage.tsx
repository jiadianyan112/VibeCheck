import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AccessStatusBadge, AssetCard, Button, CompletenessLabel, DisputeNotice, EmptyState, ErrorPanel, EvidenceDrawer, ExternalLinkGuard, FreshnessLabel, LoadingState, ProjectCard, Tag, UnknownFact, evidenceTypeLabels, useToast } from '../components'
import { authorManagementState, latestVerificationFor, mergeEvidenceRecords, publishedEventFromSubmission, publishedProjectFromSubmission, useAuthGate, useComparison, verificationStatusLabels } from '../features'
import { submissionReturnPath } from '../features/submission'
import { communityService, projectService, type ProjectBundle, type ServiceError } from '../services'
import { creatorsForProject, prototypeUsers } from '../mocks'
import { createPrototypeEvent, useAppState } from '../state'
import type { CommentCategory, FieldFact, Project, ProjectComment, UserId } from '../types'
import { accessStatusText, feedbackMethodLabels, inputTypeLabels, lifecycleEventLabels, scenarioLabels, targetUserLabels } from '../utils'

const sourceLabels: Record<Project['recordSource'], string> = {
  platform_editor: '平台编辑收录',
  public_discovery: '公开页面发现',
  author_submission: '作者主动发布',
  user_submission: '社区用户提交',
}

const authorLinkLabels: Record<Project['authorLinkStatus'], string> = {
  unlinked: '尚未关联作者',
  pending: '作者关联审核中',
  linked: '已关联验证作者',
  failed: '作者关联未通过',
  disputed: '作者归属存在争议',
}

function factText(fact: Project['currentName'], fallback: string) {
  return fact.state === 'known' ? fact.value : fallback
}

const outputLabels: Record<string, string> = { questions: '题目', practice_set: '练习集', exam: '试卷', score: '评分', answer_explanation: '答案解析', learning_report: '学习报告', mistake_set: '错题集', flashcards: '闪卡' }
const loginLabels: Record<string, string> = { none: '无需登录', partial: '部分功能需登录', required: '必须登录', unknown: '未知' }
const sharingLabels: Record<string, string> = { none: '不支持公开分享', link: '链接分享', result: '结果分享', question_bank: '题库分享', collaboration: '协作分享', unknown: '未知' }
const portfolioLabels: Record<string, string> = {
  personal_homepage: '个人主页', portfolio: '作品集', online_resume: '在线简历', academic_homepage: '学术主页', hybrid: '混合站点',
  developer: '开发者', designer: '设计师', product_manager: '产品经理', creator: '创作者', freelancer: '自由职业者', student_recruit: '学生/应届生', researcher_academic: '研究者', multidisciplinary: '跨领域创作者', other: '其他',
  showcase_projects: '展示项目', professional_presence: '建立职业形象', job_search: '求职', client_acquisition: '获取客户', personal_brand: '个人品牌', academic_profile: '学术档案', content_hub: '内容枢纽',
  single_page: '单页', multi_page: '多页', top_nav: '顶部导航', side_nav: '侧边导航', section_anchor: '章节锚点', minimal_overlay: '极简浮层', no_persistent_nav: '无常驻导航',
  hero: '首屏', about: '关于', projects: '项目', experience: '经历', skills: '技能', services: '服务', testimonials: '客户评价', contact: '联系', blog: '博客', resume: '简历', publications: '论文', speaking: '演讲', now_page: '近况',
  card_grid: '卡片网格', gallery: '画廊', timeline: '时间线', case_study_list: 'Case Study 列表', repository_list: '仓库列表', full_bleed: '通栏展示', mixed: '混合展示', none: '无',
  summary: '摘要', overview: '概览', deep: '深度 Case Study', minimal: '极简', editorial: '编辑感', brutalist: '粗野主义', playful: '趣味', retro: '复古', corporate: '专业商务', experimental: '实验性', illustrative: '插画主导', photographic: '摄影主导', typographic: '字体主导',
  editorial_grid: '编辑网格', bento: 'Bento', split_screen: '分屏', immersive: '沉浸式', freeform: '自由布局', monochrome: '单色', neutral: '中性色', brand_led: '品牌色主导', vivid: '高饱和', gradient_dominant: '渐变主导', light_only: '仅浅色', dark_only: '仅深色', switchable: '可切换', system_adaptive: '跟随系统',
  static: '静态', light: '轻量', moderate: '中等', high: '高交互', microinteraction: '微交互', scroll_reveal: '滚动出现', scroll_driven: '滚动驱动', page_transition: '页面转场', cursor_effect: '光标效果', motion_graphics: '动态图形', confirmed: '已确认响应式', partial: '部分响应式', content_managed: 'CMS 博客', unknown: '未知',
}
const aiToolLabels: Record<string, string> = { cursor: 'Cursor', lovable: 'Lovable', bolt: 'Bolt', v0: 'v0', replit: 'Replit', claude_code: 'Claude Code', codex: 'Codex', other: '其他', unknown: '未知' }
const relationLabels: Record<string, string> = { similar: '相似', alternative: '替代', inspired_by: '启发', fork: 'Fork', remix: 'Remix', migration: '迁移', derivative: '衍生', uses_asset: '复用资产', reference: '参考', based_on_template: '基于模板', uses_component: '使用组件', source_derivative: '源码衍生' }
const relationStatusLabels: Record<string, string> = { pending: '待确认', one_party_confirmed: '一方确认', both_parties_confirmed: '双方确认', platform_confirmed: '平台确认', disputed: '存在争议' }
const commentCategoryLabels: Record<CommentCategory, string> = { usage_feedback: '使用反馈', development_question: '开发问题', reuse_feedback: '复用反馈', status_update: '状态补充' }
const changeFieldLabels: Record<string, string> = { currentName: '作品名称', coreFeatures: '核心功能', feedbackMethods: '反馈方式', accessStatus: '访问状态', httpCheckStatus: '链接检查', address: '公开地址', version: '版本', product: '产品信息', development: '开发信息', asset: '复用资产', status: '作品状态' }
const changeValueLabels: Record<string, string> = { ...accessStatusText, ...feedbackMethodLabels, ...inputTypeLabels, ...outputLabels, ...scenarioLabels, ...targetUserLabels, normal: '正常', redirect: '发生跳转', timeout: '访问超时', unavailable: '无法访问' }

function FactBlock<T>({ label, fact, children }: { label: string; fact: FieldFact<T>; children: (value: T) => ReactNode }) {
  return <div className="profile-field"><dt>{label}</dt><dd className="profile-field__value">{fact.state === 'known' ? children(fact.value) : <UnknownFact reason={fact.reason} />}</dd></div>
}

function tagList(values: readonly string[], labels: Record<string, string>) {
  return <div className="cluster">{values.map((value) => <Tag key={value}>{labels[value] ?? value}</Tag>)}</div>
}

function similarPath(project: Project) {
  if (project.categoryId === 'personal_site_portfolio') {
    const query = project.summary.state === 'known' ? project.summary.value : factText(project.currentName, '')
    return `/search?mode=works&category=personal_site_portfolio&q=${encodeURIComponent(query)}`
  }
  const params = new URLSearchParams({ idea: project.coreProblem.state === 'known' ? project.coreProblem.value : factText(project.currentName, '') })
  if (project.targetUsers.state === 'known') project.targetUsers.value.forEach((value) => params.append('target', value))
  if (project.useScenarios.state === 'known') project.useScenarios.value.forEach((value) => params.append('scenario', value))
  if (project.mainInputs.state === 'known') project.mainInputs.value.forEach((value) => params.append('input', value))
  if (project.practiceFormats.state === 'known') project.practiceFormats.value.forEach((value) => params.append('practice', value))
  if (project.mainOutputs.state === 'known') project.mainOutputs.value.forEach((value) => params.append('output', value))
  return `/discover/result?${params}`
}

function readableChange(value: unknown) {
  if (value === null) return '空值'
  if (Array.isArray(value)) return value.map((item) => changeValueLabels[String(item)] ?? String(item)).join('、')
  if (typeof value === 'object') return JSON.stringify(value)
  return changeValueLabels[String(value)] ?? String(value)
}

function uniqueById<T extends { id: string }>(items: readonly T[]) {
  return items.filter((item, index) => items.findIndex((candidate) => candidate.id === item.id) === index)
}

export function ProjectDetailPage() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const { state, dispatch } = useAppState()
  const resolvedId = (id ? state.projectAliases[id] ?? id : id) as Project['id']
  const { requireLogin } = useAuthGate()
  const { addProject } = useComparison()
  const { pushToast } = useToast()
  const [bundle, setBundle] = useState<ProjectBundle | null>(null)
  const [error, setError] = useState<ServiceError | null>(null)
  const [loading, setLoading] = useState(true)
  const [comments, setComments] = useState<ProjectComment[]>([])
  const [commentDraft, setCommentDraft] = useState('')
  const [commentCategory, setCommentCategory] = useState<CommentCategory>('usage_feedback')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [pendingCommentId, setPendingCommentId] = useState<string | null>(null)
  const trackedProjectId = useRef<Project['id'] | null>(null)

  const trackProjectView = useCallback((projectId: Project['id']) => {
    if (trackedProjectId.current === projectId) return
    trackedProjectId.current = projectId
    dispatch({ type: 'RECENT_PROJECT_ADD', projectId })
    dispatch({ type: 'EVENT_LOGGED', event: createPrototypeEvent('project_viewed', { projectId }) })
  }, [dispatch])
  const submittedBundle = useMemo<ProjectBundle | null>(() => {
    const draft = state.submissionDrafts.find((item) => item.publishedProjectId === resolvedId && item.status === 'approved')
    if (!draft) return null
    const project = publishedProjectFromSubmission(draft)
    const event = publishedEventFromSubmission(draft)
    if (!project || !event) return null
    const currentProject = state.projectOverrides.find((item) => item.id === project.id) ?? project
    const events = [event, ...state.lifecycleEventAdditions.filter((item) => item.projectId === project.id)]
      .filter((item, index, values) => values.findIndex((value) => value.id === item.id) === index)
    return { project: currentProject, relatedProjects: [], creators: [], events, assets: state.reusableAssetAdditions.filter((item) => item.projectId === project.id), relations: [], evidences: [] }
  }, [resolvedId, state.lifecycleEventAdditions, state.projectOverrides, state.reusableAssetAdditions, state.submissionDrafts])

  useEffect(() => {
    let active = true
    setLoading(true)
    if (submittedBundle) {
      setBundle(submittedBundle)
      setComments([])
      setError(null)
      setLoading(false)
      trackProjectView(submittedBundle.project.id)
      return () => { active = false }
    }
    Promise.all([
      projectService.getBundle(resolvedId, { scenario: state.serviceScenario }),
      communityService.listComments(resolvedId, { scenario: state.serviceScenario }),
    ]).then(([result, commentResult]) => {
      if (!active) return
      if (result.ok && commentResult.ok) {
        const projectOverride = state.projectOverrides.find((project) => project.id === result.data.project.id)
        const mergedBundle = {
          ...result.data,
          project: projectOverride ?? result.data.project,
          evidences: mergeEvidenceRecords(result.data.evidences, state.evidenceOverrides.filter((evidence) => evidence.supports.projectId === result.data.project.id)),
          events: uniqueById([...result.data.events, ...state.lifecycleEventAdditions.filter((event) => event.projectId === result.data.project.id)]),
          assets: [...result.data.assets, ...state.reusableAssetAdditions.filter((asset) => asset.projectId === result.data.project.id)],
        }
        setBundle(mergedBundle); setError(null)
        setComments(commentResult.data)
        trackProjectView(mergedBundle.project.id)
      } else setError(!result.ok ? result.error : commentResult.ok ? null : commentResult.error)
      setLoading(false)
    })
    return () => { active = false }
  }, [resolvedId, state.evidenceOverrides, state.lifecycleEventAdditions, state.projectOverrides, state.reusableAssetAdditions, state.serviceScenario, submittedBundle, trackProjectView])

  useEffect(() => {
    if (!pendingCommentId || state.lastReplayedActionId !== pendingCommentId || !state.session.user || !commentDraft.trim()) return
    const newComment: ProjectComment = { id: pendingCommentId, projectId: resolvedId, authorUserId: state.session.user.id, category: commentCategory, body: commentDraft.trim(), parentId: replyTo, moderationStatus: 'visible', reportCount: 0, createdAt: new Date().toISOString() }
    setComments((current) => [...current, newComment])
    dispatch({ type: 'EVENT_LOGGED', event: createPrototypeEvent('comment_created', { projectId: newComment.projectId, commentId: newComment.id }) })
    setCommentDraft(''); setReplyTo(null); setPendingCommentId(null)
  }, [commentCategory, commentDraft, dispatch, pendingCommentId, replyTo, resolvedId, state.lastReplayedActionId, state.session.user])

  if (loading) return <main className="page-container"><LoadingState label="作品档案加载中" /></main>
  if (error || !bundle) return <main className="page-container stack"><ErrorPanel message={error?.message ?? '未找到作品'} /><Link to="/projects">返回作品广场</Link></main>

  const { project, creators } = bundle
  const name = factText(project.currentName, '名称未知的作品')
  const status = project.accessStatus.state === 'known' ? project.accessStatus.value : 'unknown'
  const selected = state.comparisonProjectIds.includes(project.id)
  const favorited = state.favoriteProjectIds.includes(project.id)
  const liked = state.likedProjectIds.includes(project.id)
  const portfolio = project.categoryId === 'personal_site_portfolio' ? project.categoryData : null
  const trustVariant = searchParams.get('variant')
  const submissionUrl = searchParams.get('from') === 'submit'
    ? searchParams.get('submissionUrl')
    : null
  const submissionScenario = searchParams.get('submissionScenario')
  const orderedFlow = project.coreFlow.state === 'known' ? [...project.coreFlow.value].sort((a, b) => a.order - b.order) : []
  const ownVerification = latestVerificationFor(state.verificationRequests, project.id, state.session.user?.id)
  const management = authorManagementState(ownVerification)
  const effectiveAuthorLinkStatus = management.linked ? 'linked' : management.highRiskEditingFrozen ? 'disputed' : ownVerification ? 'pending' : project.authorLinkStatus

  function toggleFavorite() {
    requireLogin({ id: `favorite-${project.id}`, kind: 'favorite', projectId: project.id, sourcePath: `/project/${project.id}` }, () => dispatch({ type: 'FAVORITE_TOGGLE', projectId: project.id }))
  }

  async function shareProject() {
    const shareText = `${name} · VibeCheck`
    try { await navigator.clipboard?.writeText(window.location.href) } catch { /* visible feedback still confirms the action */ }
    pushToast(`已准备分享：${shareText}`, 'success')
  }

  function appendComment(authorUserId: UserId, commentId: string) {
    const next: ProjectComment = { id: commentId, projectId: project.id, authorUserId, category: commentCategory, body: commentDraft.trim(), parentId: replyTo, moderationStatus: 'visible', reportCount: 0, createdAt: new Date().toISOString() }
    setComments((current) => [...current, next])
    dispatch({ type: 'EVENT_LOGGED', event: createPrototypeEvent('comment_created', { projectId: project.id, commentId }) })
    setCommentDraft(''); setReplyTo(null)
  }

  function submitComment() {
    if (!commentDraft.trim()) return
    const commentId = `comment-${project.id}-${Date.now()}`
    if (state.session.user) { appendComment(state.session.user.id, commentId); return }
    setPendingCommentId(commentId)
    requireLogin({ id: commentId, kind: 'comment', sourcePath: `/project/${project.id}#discussion`, payload: { body: commentDraft, category: commentCategory, parentId: replyTo ?? '' } })
  }

  function reportComment(commentId: string) {
    setComments((current) => current.map((comment) => comment.id === commentId ? { ...comment, reportCount: comment.reportCount + 1, moderationStatus: 'under_review' } : comment))
    pushToast('举报已记录，评论历史保留并进入审核。')
  }

  return (
    <main className="page-container page-with-bottom-space project-detail-page stack">
      {id && resolvedId !== id ? <aside className="feedback" role="status"><strong>作品页面已合并</strong><p>你访问的是旧链接，现已自动跳转到合并后的作品页面。</p></aside> : null}
      {project.reviewStatus === 'restricted' ? <aside className="feedback feedback--error" role="alert"><strong>此作品暂不公开展示</strong><p>公开体验入口暂不可用，已有更新记录仍会保留。</p></aside> : null}
      {submissionUrl ? (
        <aside className="submission-context-banner stack stack--small" aria-label="发布查重上下文">
          <strong>你正在核对发布时发现的已有档案</strong>
          <p>待发布地址：{submissionUrl}。返回后地址输入会保留。</p>
          <Link
            className="button"
            to={submissionReturnPath(
              submissionUrl,
              submissionScenario === 'duplicate_project' ? 'duplicate_project' : 'default',
            )}
          >
            返回发布查重
          </Link>
        </aside>
      ) : null}
      <nav aria-label="面包屑"><Link to="/projects">作品广场</Link> / {name}</nav>
      <section className="project-hero">
        <div className="media-placeholder project-hero__media" aria-label={project.coverMedia[0]?.alt ?? `${name} 媒体占位`}>16:9 作品媒体占位</div>
        <div className="project-hero__content stack">
          <div className="cluster"><AccessStatusBadge status={status} /><FreshnessLabel status={project.freshnessStatus} lastVerifiedAt={project.lastVerifiedAt} /><CompletenessLabel level={project.completenessLevel} /></div>
          <div className="stack stack--small"><div className="cluster"><Tag tone="dashed">{project.categoryId === 'personal_site_portfolio' ? '个人主页与作品集' : 'AI 学习与题库'}</Tag>{project.categoryGroup ? <Tag>{project.categoryGroup}</Tag> : null}</div><h1>{name}</h1>{project.summary.state === 'known' ? <p className="project-hero__definition">{project.summary.value}</p> : <UnknownFact reason={project.summary.reason} />}</div>

          <section className="project-source stack stack--small" aria-label="作者与来源">
            <div className="cluster cluster--between"><div><strong>{authorLinkLabels[effectiveAuthorLinkStatus]}</strong><p>{sourceLabels[project.recordSource]}</p></div>{creators.length || management.linked ? <div className="cluster">{creators.map((creator) => <Link key={creator.id} to={`/creator/${creator.id}`}><Tag tone={creator.verificationStatus === 'verified' ? 'default' : 'dashed'}>{creator.displayName} · {creator.verificationStatus === 'verified' ? '已验证' : '未验证'}</Tag></Link>)}{management.linked && state.session.user ? <Tag>{state.session.user.displayName} · 已验证管理权限</Tag> : null}</div> : <span className="unknown-value">未发现已确认的公开作者</span>}</div>
            <div className="cluster"><Link className="weak-link" to={`/project/${project.id}/verify-author`}>{ownVerification ? `查看身份验证：${verificationStatusLabels[ownVerification.status]}` : '我是作者，申请关联'}</Link>{management.canEdit ? <Link className="button" to={`/project/${project.id}/update`}>管理作品</Link> : null}</div>
            {management.highRiskEditingFrozen ? <aside className="trust-notice trust-notice--disputed"><strong>归属争议处理中</strong><p>高风险编辑已冻结；公开档案和历史事实继续保留。</p></aside> : null}
          </section>

          <div className="project-primary-actions" aria-label="作品核心操作">
            {project.reviewStatus === 'restricted' ? <Button variant="primary" disabled>展示已限制</Button> : project.publicUrl.state === 'known' ? <ExternalLinkGuard href={project.publicUrl.value}>立即体验</ExternalLinkGuard> : <Button variant="primary" disabled>体验地址未知</Button>}
            <Button aria-pressed={favorited} onClick={toggleFavorite}>{favorited ? '取消收藏' : '收藏'}</Button>
            <Button onClick={shareProject}>分享</Button>
            <Button aria-pressed={selected} onClick={() => selected ? dispatch({ type: 'COMPARISON_REMOVE', projectId: project.id }) : addProject(project.id)}>{selected ? '移出比较' : '加入比较'}</Button>
          </div>
        </div>
      </section>

      <section className="interaction-strip" aria-label="社区互动"><div><strong>{project.interactionSummary.favoriteCount + (favorited ? 1 : 0)}</strong><span>收藏</span></div><div><strong>{project.interactionSummary.likeCount + (liked ? 1 : 0)}</strong><span>点赞</span></div><div><strong>{project.interactionSummary.commentCount + comments.filter((comment) => !comment.id.startsWith('comment-') || !['comment-quizforge-usage', 'comment-speakmirror-development', 'comment-echoscore-reuse', 'comment-promo-collapsed'].includes(comment.id)).length}</strong><span>讨论</span></div><Button aria-pressed={liked} onClick={() => dispatch({ type: 'LIKE_TOGGLE', projectId: project.id })}>{liked ? '已点赞' : '点赞'}</Button></section>

      <section className="trust-variants stack" aria-labelledby="trust-variants-heading">
        <div className="section-heading cluster cluster--between"><div><h2 id="trust-variants-heading">作品信息与状态</h2></div><div className="cluster"><Link className="button button--quiet" to={`/submit?mode=supplement&project=${project.id}`}>补充作品信息</Link><details className="status-report-placeholder"><summary>报告状态问题</summary><p>提交后会进入人工核对，核对完成前不会更改当前状态。</p></details></div></div>
        <div className="trust-notice-list">
          {project.recordSource === 'platform_editor' && project.authorLinkStatus === 'unlinked' ? <aside className="trust-notice"><Tag tone="dashed">平台收录</Tag><strong>尚未关联验证作者</strong><p>当前信息来自公开页面和平台核验，不代表作者本人说明。</p></aside> : null}
          {status === 'unknown' ? <aside className="trust-notice trust-notice--caution"><Tag tone="dashed">当前状态未知</Tag><strong>没有足够证据确认当前可用性</strong><p>未知不是异常或失败；历史记录仍可查看。</p></aside> : null}
          {project.freshnessStatus === 'expired' ? <aside className="trust-notice trust-notice--caution"><Tag tone="dashed">信息已过期</Tag><strong>内容可能已经发生变化</strong><p>最近核验：{new Date(project.lastVerifiedAt).toLocaleDateString('zh-CN')}。请结合当前作品页面判断。</p></aside> : null}
          {status === 'partial_abnormal' || status === 'link_unavailable' ? <aside className="trust-notice trust-notice--caution"><Tag tone="strong">访问异常</Tag><strong>{status === 'partial_abnormal' ? '部分流程异常，其他事实仍保留' : '当前公开链接不可用'}</strong><p>异常描述不等同于作品失败或结束；请结合核验时间与历史事件判断。</p></aside> : null}
          {status === 'suspected_migration' ? <aside className="trust-notice trust-notice--caution"><Tag tone="dashed">疑似迁移</Tag><strong>新地址身份等待确认</strong><p>旧地址和待确认新地址已在当前状态区并列展示。</p></aside> : null}
          {status === 'paused' ? <aside className="trust-notice"><Tag tone="strong">作者声明暂停</Tag><strong>暂停更新不等于失败</strong><p>现有演示和历史仍按各自证据展示。</p></aside> : null}
          {status === 'ended' ? <aside className="trust-notice"><Tag tone="strong">作者声明结束</Tag><strong>作品已结束，不等于失败</strong><p>仍可查看历史与独立有效的复用资产。</p></aside> : null}
          {trustVariant === 'first-anomaly' ? <aside className="trust-notice trust-notice--caution"><Tag tone="dashed">首次异常验证中</Tag><strong>维持原公开状态：{status}</strong><p>一次技术检查不能直接推导暂停、结束或失败；等待复检后再更新。</p></aside> : null}
          {trustVariant === 'disputed' ? <aside className="trust-notice trust-notice--disputed"><Tag tone="strong">争议并列来源</Tag><strong>核查完成前不选择性覆盖</strong><div className="dispute-source-grid"><article><span>平台核验记录</span><p>{bundle.evidences[0]?.sourceSummary ?? '平台当前没有可引用记录。'}</p><time dateTime={bundle.evidences[0]?.verifiedAt}>{bundle.evidences[0] ? new Date(bundle.evidences[0].verifiedAt).toLocaleString('zh-CN') : '更新时间未知'}</time></article><article><span>提交方补充说明</span><p>提交方称新入口仍属于同一作品，当前缺少足够公开材料完成确认。</p><time dateTime="2026-07-30T18:00:00+08:00">2026/7/30 18:00 更新</time></article></div></aside> : null}
        </div>
        <EvidenceDrawer label="展开本作品证据" evidences={bundle.evidences} />
      </section>

      {portfolio ? <section className="project-profile stack" aria-labelledby="portfolio-structure-heading">
        <div className="section-heading cluster cluster--between"><div><h2 id="portfolio-structure-heading">定位与内容结构</h2><p>了解网站面向什么身份与目的，以及如何组织主页、项目和经历。</p></div><Link className="button" to={similarPath(project)}>查找相似作品</Link></div>
        <dl className="profile-field-grid">
          <FactBlock label="网站类型" fact={portfolio.siteType}>{(value) => <Tag>{portfolioLabels[value]}</Tag>}</FactBlock>
          <FactBlock label="作者身份" fact={portfolio.creatorRoles}>{(value) => tagList(value, portfolioLabels)}</FactBlock>
          <FactBlock label="建站目的" fact={portfolio.primaryGoals}>{(value) => tagList(value, portfolioLabels)}</FactBlock>
          <FactBlock label="页面结构" fact={portfolio.pageModel}>{(value) => <Tag>{portfolioLabels[value]}</Tag>}</FactBlock>
          <FactBlock label="导航方式" fact={portfolio.navigationPattern}>{(value) => <Tag>{portfolioLabels[value]}</Tag>}</FactBlock>
          <FactBlock label="核心模块" fact={portfolio.coreModules}>{(value) => tagList(value, portfolioLabels)}</FactBlock>
        </dl>
        <div className="section-heading"><h2>项目展示与 Case Study</h2></div>
        <dl className="profile-field-grid"><FactBlock label="项目展示形式" fact={portfolio.projectShowcaseFormat}>{(value) => <Tag>{portfolioLabels[value]}</Tag>}</FactBlock><FactBlock label="Case Study 深度" fact={portfolio.caseStudyDepth}>{(value) => <Tag>{portfolioLabels[value]}</Tag>}</FactBlock></dl>
        <div className="section-heading"><h2>视觉与交互</h2></div>
        <dl className="profile-field-grid">
          <FactBlock label="视觉风格" fact={portfolio.visualStyles}>{(value) => tagList(value, portfolioLabels)}</FactBlock>
          <FactBlock label="布局方式" fact={portfolio.layoutPatterns}>{(value) => tagList(value, portfolioLabels)}</FactBlock>
          <FactBlock label="色彩特征" fact={portfolio.colorCharacter}>{(value) => <Tag>{portfolioLabels[value]}</Tag>}</FactBlock>
          <FactBlock label="主题模式" fact={portfolio.themeMode}>{(value) => <Tag>{portfolioLabels[value]}</Tag>}</FactBlock>
          <FactBlock label="交互等级" fact={portfolio.interactionLevel}>{(value) => <Tag>{portfolioLabels[value]}</Tag>}</FactBlock>
          <FactBlock label="动画方式" fact={portfolio.interactionPatterns}>{(value) => tagList(value, portfolioLabels)}</FactBlock>
          <FactBlock label="响应式" fact={portfolio.responsiveSupport}>{(value) => <Tag>{portfolioLabels[value]}</Tag>}</FactBlock>
          <FactBlock label="博客能力" fact={portfolio.blogSupport}>{(value) => <Tag>{portfolioLabels[value]}</Tag>}</FactBlock>
        </dl>
      </section> : <section className="project-profile stack" aria-labelledby="product-structure-heading">
        <div className="section-heading cluster cluster--between"><div><h2 id="product-structure-heading">产品结构</h2><p>了解作品面向谁、解决什么问题，以及如何完成核心流程。</p></div><Link className="button" to={similarPath(project)}>查找相似作品</Link></div>
        <dl className="profile-field-grid">
          <FactBlock label="目标用户" fact={project.targetUsers}>{(value) => tagList(value, targetUserLabels)}</FactBlock>
          <FactBlock label="核心问题" fact={project.coreProblem}>{(value) => <p>{value}</p>}</FactBlock>
          <FactBlock label="使用场景" fact={project.useScenarios}>{(value) => tagList(value, scenarioLabels)}</FactBlock>
          <FactBlock label="主要输入" fact={project.mainInputs}>{(value) => tagList(value, inputTypeLabels)}</FactBlock>
          <FactBlock label="主要输出" fact={project.mainOutputs}>{(value) => tagList(value, outputLabels)}</FactBlock>
          <FactBlock label="核心功能" fact={project.coreFeatures}>{(value) => tagList(value, {})}</FactBlock>
          <FactBlock label="登录要求" fact={project.loginRequirement}>{(value) => <span>{loginLabels[value]}</span>}</FactBlock>
          <FactBlock label="分享能力" fact={project.sharingCapability}>{(value) => <span>{sharingLabels[value]}</span>}</FactBlock>
        </dl>
        <section className="core-flow stack"><h3>核心流程</h3>{project.coreFlow.state === 'known' ? <ol>{orderedFlow.map((node) => <li key={node.id}><span>{node.order}</span><div><strong>{node.label}</strong><p>{node.description}</p></div></li>)}</ol> : <UnknownFact reason={project.coreFlow.reason} />}</section>
      </section>}

      <section className="development-profile stack" aria-labelledby="development-heading">
        <div className="section-heading"><h2 id="development-heading">开发信息</h2><p>查看构建工具、技术栈和公开的实现信息。</p></div>
        <dl className="profile-field-grid">
          <FactBlock label="AI 编程工具" fact={project.aiCodingTools}>{(value) => tagList(value, aiToolLabels)}</FactBlock>
          <FactBlock label="使用模型" fact={project.modelsUsed}>{(value) => tagList(value, {})}</FactBlock>
          <FactBlock label="技术栈" fact={project.techStack}>{(value) => tagList(value, {})}</FactBlock>
          <FactBlock label="部署方式" fact={project.deploymentPlatform}>{(value) => <span>{value ?? '未公开部署平台'}</span>}</FactBlock>
          <FactBlock label="开发周期" fact={project.developmentCycle}>{(value) => <span>{value ?? '未公开开发周期'}</span>}</FactBlock>
          <FactBlock label="关键依赖" fact={project.keyDependencies}>{(value) => tagList(value, {})}</FactBlock>
        </dl>
      </section>

      <section className="current-status-panel stack" aria-labelledby="current-status-heading">
        <div className="section-heading"><h2 id="current-status-heading">当前状态</h2></div>
        <div className="cluster"><AccessStatusBadge status={status} /><FreshnessLabel status={project.freshnessStatus} lastVerifiedAt={project.lastVerifiedAt} /><Tag tone="dashed">链接检查：{project.httpCheckStatus}</Tag></div>
        {project.statusNote.state === 'known' && project.statusNote.value ? <p>{project.statusNote.value}</p> : project.statusNote.state === 'unknown' ? <UnknownFact reason={project.statusNote.reason} /> : <p>当前没有额外状态说明。</p>}
        {status === 'suspected_migration' ? <aside className="migration-note stack stack--small"><strong>疑似迁移，身份尚待确认</strong>{project.historicalUrls.map((item) => <span key={item.url}>旧地址：{item.url}</span>)}{project.publicUrl.state === 'known' ? <span>待确认新地址：{project.publicUrl.value}</span> : <UnknownFact reason={project.publicUrl.reason} />}</aside> : null}
      </section>

      <section className="stack" aria-labelledby="assets-heading"><div className="section-heading"><h2 id="assets-heading">复用资产</h2><p>作品停止维护后，公开的代码、模板或组件仍可能继续使用。</p></div>{bundle.assets.length ? <div className="card-grid">{bundle.assets.map((asset) => <AssetCard key={asset.id} asset={asset} />)}</div> : <EmptyState title="暂无公开复用资产" description="这个作品目前没有公开可获取的代码、模板或组件。" />}</section>

      <section className="stack" aria-labelledby="timeline-heading"><div className="section-heading"><h2 id="timeline-heading">作品时间线</h2><p>查看作品从发布到更新、迁移或结束的重要变化。</p></div>{bundle.events.length ? <ol className="lifecycle-timeline">{[...bundle.events].sort((a, b) => b.happenedAt.localeCompare(a.happenedAt)).map((event) => { const eventEvidence = bundle.evidences.filter((evidence) => event.evidenceIds.includes(evidence.id)); return <li key={event.id} id={event.id} className="timeline-event stack stack--small"><div className="cluster cluster--between"><div className="cluster"><Tag>{lifecycleEventLabels[event.type]}</Tag><Tag tone={event.sourceType === 'system_inference' ? 'dashed' : 'default'}>{evidenceTypeLabels[event.sourceType]}</Tag></div><time dateTime={event.happenedAt}>{new Date(event.happenedAt).toLocaleDateString('zh-CN')}{event.isEstimatedDate ? '（约）' : ''}</time></div><strong>{event.summary}</strong>{event.changes.length ? <dl className="event-changes">{event.changes.map((change, index) => <div key={`${change.fieldKey}-${index}`}><dt>{changeFieldLabels[change.fieldKey] ?? '信息变化'}</dt><dd><span>之前：{readableChange(change.before)}</span><span>之后：{readableChange(change.after)}</span></dd></div>)}</dl> : <p className="page-description">暂无更多变化说明。</p>}<DisputeNotice status={event.disputeStatus} /><EvidenceDrawer label="事件来源" evidences={eventEvidence} /></li>})}</ol> : <EmptyState title="暂无作品动态" />}</section>

      <section className="stack" aria-labelledby="relations-heading"><div className="section-heading"><h2 id="relations-heading">相关作品</h2></div>{bundle.relations.length ? <div className="relationship-list">{bundle.relations.map((relation) => { const relatedId = relation.sourceProjectId === project.id ? relation.targetProjectId : relation.sourceProjectId; const related = bundle.relatedProjects.find((item) => item.id === relatedId); return <article key={relation.id} className="relationship-card stack stack--small"><div className="cluster"><Tag tone="strong">{relationLabels[relation.type]}</Tag><Tag tone={relation.confirmationStatus === 'platform_confirmed' ? 'default' : 'dashed'}>{relationStatusLabels[relation.confirmationStatus]}</Tag><span>{relation.direction === 'two_way' ? '双向关系' : '单向关系'}</span></div><p>{relation.summary}</p>{related ? <ProjectCard project={related} creators={creatorsForProject(related)} variant="compact" selectedForCompare={state.comparisonProjectIds.includes(related.id)} onToggleCompare={(item) => state.comparisonProjectIds.includes(item.id) ? dispatch({ type: 'COMPARISON_REMOVE', projectId: item.id }) : addProject(item.id)} /> : <UnknownFact reason="相关作品暂时不可用" />}<EvidenceDrawer label="关系来源" evidences={bundle.evidences.filter((evidence) => relation.evidenceIds.includes(evidence.id))} /></article>})}</div> : <EmptyState title="暂时没有确认的相关作品" />}</section>

      <section id="discussion" className="discussion-section stack" aria-labelledby="discussion-heading">
        <div className="section-heading"><h2 id="discussion-heading">作品讨论</h2><p>交流使用体验、实现方法和改进建议。</p></div>
        {comments.length ? <ol className="comment-list">{comments.map((comment) => { const author = prototypeUsers.find((user) => user.id === comment.authorUserId); const content = <><div className="cluster cluster--between"><div className="cluster"><Tag>{commentCategoryLabels[comment.category]}</Tag><strong>{author?.displayName ?? '社区用户'}</strong>{comment.parentId ? <span>回复</span> : null}</div><time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleDateString('zh-CN')}</time></div><p>{comment.body}</p><div className="cluster"><Button variant="quiet" onClick={() => { setReplyTo(comment.id); document.getElementById('comment-body')?.focus() }}>回复</Button><Button variant="quiet" onClick={() => reportComment(comment.id)}>{comment.moderationStatus === 'under_review' ? '已举报审核中' : '举报'}</Button>{comment.reportCount ? <span>{comment.reportCount} 次举报记录</span> : null}</div></>; return <li key={comment.id} className={`comment-card ${comment.parentId ? 'comment-card--reply' : ''}`}>{comment.moderationStatus === 'collapsed' ? <details><summary>该评论因与作品无关而折叠</summary>{content}</details> : content}</li>})}</ol> : <EmptyState title="还没有人讨论这个作品" description="可以从使用体验、开发过程或复用方式开始聊。" />}
        <div className="comment-composer stack"><div className="cluster cluster--between"><h3>{replyTo ? '回复评论' : '参与讨论'}</h3>{replyTo ? <Button variant="quiet" onClick={() => setReplyTo(null)}>取消回复</Button> : null}</div><label className="field"><span className="field__label">评论类别</span><select className="input" value={commentCategory} onChange={(event) => setCommentCategory(event.target.value as CommentCategory)}>{Object.entries(commentCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span className="field__label">评论内容</span><textarea id="comment-body" className="input textarea" rows={4} value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="分享具体的使用体验、实现方法或复用建议" /></label><Button variant="primary" disabled={!commentDraft.trim()} onClick={submitComment}>发布评论</Button></div>
      </section>
    </main>
  )
}
