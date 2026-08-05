import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AccessStatusBadge, AssetCard, Button, CompletenessLabel, DisputeNotice, EmptyState, ErrorPanel, EvidenceDrawer, ExternalLinkGuard, FreshnessLabel, LoadingState, ProjectCard, Tag, UnknownFact, evidenceTypeLabels, useToast } from '../components'
import { authorManagementState, latestVerificationFor, mergeEvidenceRecords, publishedEventFromSubmission, publishedProjectFromSubmission, useAuthGate, useComparison, verificationStatusLabels } from '../features'
import { submissionReturnPath } from '../features/submission'
import { communityService, projectService, type ProjectBundle, type ServiceError } from '../services'
import { prototypeUsers } from '../mocks'
import { createPrototypeEvent, useAppState } from '../state'
import type { CommentCategory, Evidence, FieldFact, Project, ProjectComment, UserId } from '../types'
import { inputTypeLabels, lifecycleEventLabels, scenarioLabels, targetUserLabels } from '../utils'

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
const aiToolLabels: Record<string, string> = { cursor: 'Cursor', lovable: 'Lovable', bolt: 'Bolt', v0: 'v0', replit: 'Replit', claude_code: 'Claude Code', codex: 'Codex', other: '其他', unknown: '未知' }
const relationLabels: Record<string, string> = { similar: '相似', alternative: '替代', inspired_by: '启发', fork: 'Fork', remix: 'Remix', migration: '迁移', derivative: '衍生', uses_asset: '复用资产' }
const relationStatusLabels: Record<string, string> = { pending: '待确认', one_party_confirmed: '一方确认', both_parties_confirmed: '双方确认', platform_confirmed: '平台确认', disputed: '存在争议' }
const commentCategoryLabels: Record<CommentCategory, string> = { usage_feedback: '使用反馈', development_question: '开发问题', reuse_feedback: '复用反馈', status_update: '状态补充' }

function FactBlock<T>({ label, fact, evidences, children }: { label: string; fact: FieldFact<T>; evidences: Evidence[]; children: (value: T) => ReactNode }) {
  const sources = evidences.filter((evidence) => fact.evidenceIds.includes(evidence.id))
  return <div className="profile-field"><dt>{label}</dt><dd>{fact.state === 'known' ? children(fact.value) : <UnknownFact reason={fact.reason} />}</dd><EvidenceDrawer label={`${label}来源`} evidences={sources} /></div>
}

function tagList(values: readonly string[], labels: Record<string, string>) {
  return <div className="cluster">{values.map((value) => <Tag key={value}>{labels[value] ?? value}</Tag>)}</div>
}

function similarPath(project: Project) {
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
  if (Array.isArray(value)) return value.join('、')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
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
      dispatch({ type: 'RECENT_PROJECT_ADD', projectId: submittedBundle.project.id })
      dispatch({ type: 'EVENT_LOGGED', event: createPrototypeEvent('project_viewed', { projectId: submittedBundle.project.id }) })
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
          events: [...result.data.events, ...state.lifecycleEventAdditions.filter((event) => event.projectId === result.data.project.id)],
          assets: [...result.data.assets, ...state.reusableAssetAdditions.filter((asset) => asset.projectId === result.data.project.id)],
        }
        setBundle(mergedBundle); setError(null)
        setComments(commentResult.data)
        dispatch({ type: 'RECENT_PROJECT_ADD', projectId: mergedBundle.project.id })
        dispatch({ type: 'EVENT_LOGGED', event: createPrototypeEvent('project_viewed', { projectId: mergedBundle.project.id }) })
      } else setError(!result.ok ? result.error : commentResult.ok ? null : commentResult.error)
      setLoading(false)
    })
    return () => { active = false }
  }, [dispatch, resolvedId, state.evidenceOverrides, state.lifecycleEventAdditions, state.projectOverrides, state.reusableAssetAdditions, state.serviceScenario, submittedBundle])

  useEffect(() => {
    if (!pendingCommentId || state.lastReplayedActionId !== pendingCommentId || !state.session.user || !commentDraft.trim()) return
    const newComment: ProjectComment = { id: pendingCommentId, projectId: resolvedId, authorUserId: state.session.user.id, category: commentCategory, body: commentDraft.trim(), parentId: replyTo, moderationStatus: 'visible', reportCount: 0, createdAt: new Date().toISOString() }
    setComments((current) => [...current, newComment])
    dispatch({ type: 'EVENT_LOGGED', event: createPrototypeEvent('comment_created', { projectId: newComment.projectId, commentId: newComment.id }) })
    setCommentDraft(''); setReplyTo(null); setPendingCommentId(null)
  }, [commentCategory, commentDraft, dispatch, pendingCommentId, replyTo, resolvedId, state.lastReplayedActionId, state.session.user])

  if (loading) return <main className="page-container"><LoadingState label="作品档案加载中" /></main>
  if (error || !bundle) return <main className="page-container stack"><ErrorPanel message={error?.message ?? '未找到作品'} detail={error?.code} /><Link to="/projects">返回作品广场</Link></main>

  const { project, creators } = bundle
  const name = factText(project.currentName, '名称未知的作品')
  const status = project.accessStatus.state === 'known' ? project.accessStatus.value : 'unknown'
  const selected = state.comparisonProjectIds.includes(project.id)
  const favorited = state.favoriteProjectIds.includes(project.id)
  const followed = state.followedProjectIds.includes(project.id)
  const liked = state.likedProjectIds.includes(project.id)
  const trustVariant = searchParams.get('variant')
  const submissionUrl = searchParams.get('from') === 'submit'
    ? searchParams.get('submissionUrl')
    : null
  const submissionScenario = searchParams.get('submissionScenario')
  const orderedFlow = project.coreFlow.state === 'known' ? [...project.coreFlow.value].sort((a, b) => a.order - b.order) : []
  const ownVerification = latestVerificationFor(state.verificationRequests, project.id, state.session.user?.id)
  const management = authorManagementState(ownVerification)
  const effectiveAuthorLinkStatus = management.linked ? 'linked' : management.highRiskEditingFrozen ? 'disputed' : ownVerification ? 'pending' : project.authorLinkStatus

  function protectedToggle(kind: 'favorite' | 'follow') {
    requireLogin({ id: `${kind}-${project.id}`, kind, projectId: project.id, sourcePath: `/project/${project.id}` }, () => dispatch({ type: kind === 'favorite' ? 'FAVORITE_TOGGLE' : 'FOLLOW_TOGGLE', projectId: project.id }))
  }

  async function shareProject() {
    const shareText = `${name} · VibeCheck`
    try { await navigator.clipboard?.writeText(window.location.href) } catch { /* the prototype still provides visible share feedback */ }
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
    <main className="page-container page-with-bottom-space stack">
      {id && resolvedId !== id ? <aside className="feedback" role="status"><strong>此旧作品 ID 已合并</strong><p><code>{id}</code> 已稳定映射到主档 <code>{resolvedId}</code>；历史引用继续可访问。</p></aside> : null}
      {project.reviewStatus === 'restricted' ? <aside className="feedback feedback--error" role="alert"><strong>此作品已限制公开展示</strong><p>档案与历史仍保留用于审计，公开体验入口暂不可用。</p></aside> : null}
      {submissionUrl ? (
        <aside className="submission-context-banner stack stack--small" aria-label="发布查重上下文">
          <strong>你正在核对发布时发现的已有档案</strong>
          <p>待发布地址：<code>{submissionUrl}</code>。返回后地址输入会保留。</p>
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
          <div className="stack stack--small"><p className="eyebrow">Project profile</p><h1>{name}</h1>{project.oneLineDefinition.state === 'known' ? <p className="project-hero__definition">{project.oneLineDefinition.value}</p> : <UnknownFact reason={project.oneLineDefinition.reason} />}</div>

          <section className="project-source stack stack--small" aria-label="作者与来源">
            <div className="cluster cluster--between"><div><strong>{authorLinkLabels[effectiveAuthorLinkStatus]}</strong><p>{sourceLabels[project.recordSource]}</p></div>{creators.length || management.linked ? <div className="cluster">{creators.map((creator) => <Link key={creator.id} to={`/creator/${creator.id}`}><Tag tone={creator.verificationStatus === 'verified' ? 'default' : 'dashed'}>{creator.displayName} · {creator.verificationStatus === 'verified' ? '已验证' : '未验证'}</Tag></Link>)}{management.linked && state.session.user ? <Tag>{state.session.user.displayName} · 已验证管理权限</Tag> : null}</div> : <span className="unknown-value">未发现已确认的公开作者</span>}</div>
            <div className="cluster"><Link className="weak-link" to={`/project/${project.id}/verify-author`}>{ownVerification ? `查看身份验证：${verificationStatusLabels[ownVerification.status]}` : '我是作者，申请关联'}</Link>{management.canEdit ? <Link className="button" to={`/project/${project.id}/update`}>管理作品</Link> : null}</div>
            {management.highRiskEditingFrozen ? <aside className="trust-notice trust-notice--disputed"><strong>归属争议处理中</strong><p>高风险编辑已冻结；公开档案和历史事实继续保留。</p></aside> : null}
          </section>

          <div className="project-primary-actions" aria-label="作品核心操作">
            {project.reviewStatus === 'restricted' ? <Button variant="primary" disabled>展示已限制</Button> : project.publicUrl.state === 'known' ? <ExternalLinkGuard href={project.publicUrl.value}>立即体验</ExternalLinkGuard> : <Button variant="primary" disabled>体验地址未知</Button>}
            <Button aria-pressed={favorited} onClick={() => protectedToggle('favorite')}>{favorited ? '已收藏' : '收藏'}</Button>
            <Button aria-pressed={followed} onClick={() => protectedToggle('follow')}>{followed ? '已关注更新' : '关注更新'}</Button>
            <Button onClick={shareProject}>分享</Button>
            <Button aria-pressed={selected} onClick={() => selected ? dispatch({ type: 'COMPARISON_REMOVE', projectId: project.id }) : addProject(project.id)}>{selected ? '移出比较' : '加入比较'}</Button>
          </div>
        </div>
      </section>

      <section className="interaction-strip" aria-label="社区互动弱信号"><div><strong>{project.interactionSummary.favoriteCount + (favorited ? 1 : 0)}</strong><span>收藏</span></div><div><strong>{project.interactionSummary.likeCount + (liked ? 1 : 0)}</strong><span>点赞（弱信号）</span></div><div><strong>{project.interactionSummary.commentCount + comments.filter((comment) => !comment.id.startsWith('comment-') || !['comment-quizforge-usage', 'comment-speakmirror-development', 'comment-echoscore-reuse', 'comment-promo-collapsed'].includes(comment.id)).length}</strong><span>讨论</span></div><Button aria-pressed={liked} onClick={() => dispatch({ type: 'LIKE_TOGGLE', projectId: project.id })}>{liked ? '已点赞' : '点赞'}</Button><span className="page-description">点赞只作为轻量社区信号，不参与作品质量排序。</span></section>

      <section className="trust-variants stack" aria-labelledby="trust-variants-heading">
        <div className="section-heading cluster cluster--between"><div><p className="eyebrow">Trust state</p><h2 id="trust-variants-heading">可信状态与异常入口</h2></div><div className="cluster"><Link className="button button--quiet" to={`/submit?mode=supplement&project=${project.id}`}>补充字段信息</Link><details className="status-report-placeholder"><summary>报告状态问题</summary><p>原型占位：提交后进入人工复核，不会立刻改写当前状态或历史。</p></details></div></div>
        <div className="trust-notice-list">
          {project.recordSource === 'platform_editor' && project.authorLinkStatus === 'unlinked' ? <aside className="trust-notice"><Tag tone="dashed">平台收录</Tag><strong>尚未关联验证作者</strong><p>字段来自公开页面和平台核验，不能视为作者自述。</p></aside> : null}
          {status === 'unknown' ? <aside className="trust-notice trust-notice--caution"><Tag tone="dashed">当前状态未知</Tag><strong>没有足够证据确认当前可用性</strong><p>未知不是异常或失败；历史记录仍可查看。</p></aside> : null}
          {project.freshnessStatus === 'expired' ? <aside className="trust-notice trust-notice--caution"><Tag tone="dashed">信息已过期</Tag><strong>可继续查看，但请降低对当前字段的信任</strong><p>最近核验：{new Date(project.lastVerifiedAt).toLocaleDateString('zh-CN')}。历史事实不会因过期删除。</p></aside> : null}
          {status === 'partial_abnormal' || status === 'link_unavailable' ? <aside className="trust-notice trust-notice--caution"><Tag tone="strong">访问异常</Tag><strong>{status === 'partial_abnormal' ? '部分流程异常，其他事实仍保留' : '当前公开链接不可用'}</strong><p>异常描述不等同于作品失败或结束；请结合核验时间与历史事件判断。</p></aside> : null}
          {status === 'suspected_migration' ? <aside className="trust-notice trust-notice--caution"><Tag tone="dashed">疑似迁移</Tag><strong>新地址身份等待确认</strong><p>旧地址和待确认新地址已在当前状态区并列展示。</p></aside> : null}
          {status === 'paused' ? <aside className="trust-notice"><Tag tone="strong">作者声明暂停</Tag><strong>暂停更新不等于失败</strong><p>现有演示和历史仍按各自证据展示。</p></aside> : null}
          {status === 'ended' ? <aside className="trust-notice"><Tag tone="strong">作者声明结束</Tag><strong>作品已结束，不等于失败</strong><p>仍可查看历史与独立有效的复用资产。</p></aside> : null}
          {trustVariant === 'first-anomaly' ? <aside className="trust-notice trust-notice--caution"><Tag tone="dashed">首次异常验证中</Tag><strong>维持原公开状态：{status}</strong><p>一次技术检查不能直接推导暂停、结束或失败；等待复检后再更新。</p></aside> : null}
          {trustVariant === 'disputed' ? <aside className="trust-notice trust-notice--disputed"><Tag tone="strong">争议并列来源</Tag><strong>核查完成前不选择性覆盖</strong><div className="dispute-source-grid"><article><span>平台核验记录</span><p>{bundle.evidences[0]?.sourceSummary ?? '平台当前没有可引用记录。'}</p><time dateTime={bundle.evidences[0]?.verifiedAt}>{bundle.evidences[0] ? new Date(bundle.evidences[0].verifiedAt).toLocaleString('zh-CN') : '更新时间未知'}</time></article><article><span>提交方补充说明</span><p>提交方称新入口仍属于同一作品，当前缺少足够公开材料完成确认。</p><time dateTime="2026-07-30T18:00:00+08:00">2026/7/30 18:00 更新</time></article></div></aside> : null}
        </div>
        <EvidenceDrawer label="展开本作品证据" evidences={bundle.evidences} />
      </section>

      <section className="project-profile stack" aria-labelledby="product-structure-heading">
        <div className="section-heading cluster cluster--between"><div><p className="eyebrow">Product structure</p><h2 id="product-structure-heading">产品结构</h2><p>字段来自公开事实与固定模拟数据，不使用生成摘要补全未知值。</p></div><Link className="button" to={similarPath(project)}>从这些字段查看同类</Link></div>
        <dl className="profile-field-grid">
          <FactBlock label="目标用户" fact={project.targetUsers} evidences={bundle.evidences}>{(value) => tagList(value, targetUserLabels)}</FactBlock>
          <FactBlock label="核心问题" fact={project.coreProblem} evidences={bundle.evidences}>{(value) => <p>{value}</p>}</FactBlock>
          <FactBlock label="使用场景" fact={project.useScenarios} evidences={bundle.evidences}>{(value) => tagList(value, scenarioLabels)}</FactBlock>
          <FactBlock label="主要输入" fact={project.mainInputs} evidences={bundle.evidences}>{(value) => tagList(value, inputTypeLabels)}</FactBlock>
          <FactBlock label="主要输出" fact={project.mainOutputs} evidences={bundle.evidences}>{(value) => tagList(value, outputLabels)}</FactBlock>
          <FactBlock label="核心功能" fact={project.coreFeatures} evidences={bundle.evidences}>{(value) => tagList(value, {})}</FactBlock>
          <FactBlock label="登录要求" fact={project.loginRequirement} evidences={bundle.evidences}>{(value) => <span>{loginLabels[value]}</span>}</FactBlock>
          <FactBlock label="分享能力" fact={project.sharingCapability} evidences={bundle.evidences}>{(value) => <span>{sharingLabels[value]}</span>}</FactBlock>
        </dl>
        <section className="core-flow stack"><h3>核心流程</h3>{project.coreFlow.state === 'known' ? <ol>{orderedFlow.map((node) => <li key={node.id}><span>{node.order}</span><div><strong>{node.label}</strong><p>{node.description}</p></div></li>)}</ol> : <UnknownFact reason={project.coreFlow.reason} />}<EvidenceDrawer label="核心流程来源" evidences={bundle.evidences.filter((evidence) => project.coreFlow.evidenceIds.includes(evidence.id))} /></section>
      </section>

      <section className="development-profile stack" aria-labelledby="development-heading">
        <div className="section-heading"><p className="eyebrow">Development facts</p><h2 id="development-heading">开发信息</h2><p>以下内容用于理解实现条件，不替代作品体验与产品结构。</p></div>
        <dl className="profile-field-grid">
          <FactBlock label="AI 编程工具" fact={project.aiCodingTools} evidences={bundle.evidences}>{(value) => tagList(value, aiToolLabels)}</FactBlock>
          <FactBlock label="使用模型" fact={project.modelsUsed} evidences={bundle.evidences}>{(value) => tagList(value, {})}</FactBlock>
          <FactBlock label="技术栈" fact={project.techStack} evidences={bundle.evidences}>{(value) => tagList(value, {})}</FactBlock>
          <FactBlock label="部署方式" fact={project.deploymentPlatform} evidences={bundle.evidences}>{(value) => <span>{value ?? '未公开部署平台'}</span>}</FactBlock>
          <FactBlock label="开发周期" fact={project.developmentCycle} evidences={bundle.evidences}>{(value) => <span>{value ?? '未公开开发周期'}</span>}</FactBlock>
          <FactBlock label="关键依赖" fact={project.keyDependencies} evidences={bundle.evidences}>{(value) => tagList(value, {})}</FactBlock>
        </dl>
      </section>

      <section className="current-status-panel stack" aria-labelledby="current-status-heading">
        <div className="section-heading"><p className="eyebrow">Current status</p><h2 id="current-status-heading">当前状态说明</h2></div>
        <div className="cluster"><AccessStatusBadge status={status} /><FreshnessLabel status={project.freshnessStatus} lastVerifiedAt={project.lastVerifiedAt} /><Tag tone="dashed">技术检查：{project.httpCheckStatus}</Tag></div>
        {project.statusNote.state === 'known' && project.statusNote.value ? <p>{project.statusNote.value}</p> : project.statusNote.state === 'unknown' ? <UnknownFact reason={project.statusNote.reason} /> : <p>当前没有额外状态说明。</p>}
        {status === 'suspected_migration' ? <aside className="migration-note stack stack--small"><strong>疑似迁移，身份尚待确认</strong>{project.historicalUrls.map((item) => <span key={item.url}>旧地址：{item.url}</span>)}{project.publicUrl.state === 'known' ? <span>待确认新地址：{project.publicUrl.value}</span> : <UnknownFact reason={project.publicUrl.reason} />}</aside> : null}
      </section>

      <section className="stack" aria-labelledby="assets-heading"><div className="section-heading"><p className="eyebrow">Reusable assets</p><h2 id="assets-heading">复用资产</h2><p>资产可用性与作品当前状态分开记录；作品结束不等于资产失效。</p></div>{bundle.assets.length ? <div className="card-grid">{bundle.assets.map((asset) => <AssetCard key={asset.id} asset={asset} />)}</div> : <EmptyState title="暂无公开复用资产" description="原型不会根据技术栈推测资产存在。" />}</section>

      <section className="stack" aria-labelledby="timeline-heading"><div className="section-heading"><p className="eyebrow">Lifecycle</p><h2 id="timeline-heading">生命周期时间线</h2><p>历史事件追加展示，不会被当前字段覆盖。</p></div>{bundle.events.length ? <ol className="lifecycle-timeline">{[...bundle.events].sort((a, b) => b.happenedAt.localeCompare(a.happenedAt)).map((event) => { const eventEvidence = bundle.evidences.filter((evidence) => event.evidenceIds.includes(evidence.id)); return <li key={event.id} id={event.id} className="timeline-event stack stack--small"><div className="cluster cluster--between"><div className="cluster"><Tag>{lifecycleEventLabels[event.type]}</Tag><Tag tone={event.sourceType === 'system_inference' ? 'dashed' : 'default'}>{evidenceTypeLabels[event.sourceType]}</Tag></div><time dateTime={event.happenedAt}>{new Date(event.happenedAt).toLocaleDateString('zh-CN')}{event.isEstimatedDate ? '（约）' : ''}</time></div><strong>{event.summary}</strong>{event.changes.length ? <dl className="event-changes">{event.changes.map((change, index) => <div key={`${change.fieldKey}-${index}`}><dt>{change.fieldKey}</dt><dd><span>之前：{readableChange(change.before)}</span><span>之后：{readableChange(change.after)}</span></dd></div>)}</dl> : <p className="page-description">该事件没有结构化字段变更。</p>}<DisputeNotice status={event.disputeStatus} /><EvidenceDrawer label="事件来源" evidences={eventEvidence} /></li>})}</ol> : <EmptyState title="暂无生命周期事件" />}</section>

      <section className="stack" aria-labelledby="relations-heading"><div className="section-heading"><p className="eyebrow">Relationships</p><h2 id="relations-heading">作品关系与相关推荐</h2></div>{bundle.relations.length ? <div className="relationship-list">{bundle.relations.map((relation) => { const relatedId = relation.sourceProjectId === project.id ? relation.targetProjectId : relation.sourceProjectId; const related = bundle.relatedProjects.find((item) => item.id === relatedId); return <article key={relation.id} className="relationship-card stack stack--small"><div className="cluster"><Tag tone="strong">{relationLabels[relation.type]}</Tag><Tag tone={relation.confirmationStatus === 'platform_confirmed' ? 'default' : 'dashed'}>{relationStatusLabels[relation.confirmationStatus]}</Tag><span>{relation.direction === 'two_way' ? '双向关系' : '单向关系'}</span></div><p>{relation.summary}</p>{related ? <ProjectCard project={related} variant="compact" selectedForCompare={state.comparisonProjectIds.includes(related.id)} onToggleCompare={(item) => state.comparisonProjectIds.includes(item.id) ? dispatch({ type: 'COMPARISON_REMOVE', projectId: item.id }) : addProject(item.id)} /> : <UnknownFact reason="关系指向的作品档案不可用" />}<EvidenceDrawer label="关系来源" evidences={bundle.evidences.filter((evidence) => relation.evidenceIds.includes(evidence.id))} /></article>})}</div> : <EmptyState title="暂无已记录的作品关系" description="不会仅凭相似标签自动创建关系。" />}</section>

      <section id="discussion" className="discussion-section stack" aria-labelledby="discussion-heading">
        <div className="section-heading"><p className="eyebrow">Discussion</p><h2 id="discussion-heading">围绕此作品的讨论</h2><p>所有评论都绑定当前作品；这里不提供独立帖子、私信或用户群组。</p></div>
        {comments.length ? <ol className="comment-list">{comments.map((comment) => { const author = prototypeUsers.find((user) => user.id === comment.authorUserId); const content = <><div className="cluster cluster--between"><div className="cluster"><Tag>{commentCategoryLabels[comment.category]}</Tag><strong>{author?.displayName ?? '原型用户'}</strong>{comment.parentId ? <span>回复 {comment.parentId}</span> : null}</div><time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleDateString('zh-CN')}</time></div><p>{comment.body}</p><div className="cluster"><Button variant="quiet" onClick={() => { setReplyTo(comment.id); document.getElementById('comment-body')?.focus() }}>回复</Button><Button variant="quiet" onClick={() => reportComment(comment.id)}>{comment.moderationStatus === 'under_review' ? '已举报审核中' : '举报'}</Button>{comment.reportCount ? <span>{comment.reportCount} 次举报记录</span> : null}</div></>; return <li key={comment.id} className={`comment-card ${comment.parentId ? 'comment-card--reply' : ''}`}>{comment.moderationStatus === 'collapsed' ? <details><summary>该评论因与作品无关而折叠</summary>{content}</details> : content}</li>})}</ol> : <EmptyState title="还没有围绕这个作品的讨论" description="下方评论表单是唯一发布入口。" />}
        <div className="comment-composer stack"><div className="cluster cluster--between"><h3>{replyTo ? `回复评论 ${replyTo}` : '添加结构化评论'}</h3>{replyTo ? <Button variant="quiet" onClick={() => setReplyTo(null)}>取消回复</Button> : null}</div><label className="field"><span className="field__label">评论类别</span><select className="input" value={commentCategory} onChange={(event) => setCommentCategory(event.target.value as CommentCategory)}>{Object.entries(commentCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span className="field__label">评论内容</span><textarea id="comment-body" className="input textarea" rows={4} value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="围绕使用、开发、复用或状态提供具体信息" /></label><Button variant="primary" disabled={!commentDraft.trim()} onClick={submitComment}>发布评论</Button></div>
      </section>
    </main>
  )
}
