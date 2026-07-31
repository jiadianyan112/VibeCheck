import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AccessStatusBadge, Button, CompletenessLabel, ErrorPanel, EvidenceDrawer, ExternalLinkGuard, FreshnessLabel, LoadingState, Tag, UnknownFact, useToast } from '../components'
import { useAuthGate, useComparison } from '../features'
import { projectService, type ProjectBundle, type ServiceError } from '../services'
import { createPrototypeEvent, useAppState } from '../state'
import type { Evidence, FieldFact, Project } from '../types'
import { inputTypeLabels, practiceFormatLabels, scenarioLabels, targetUserLabels } from '../utils'

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

export function ProjectDetailPage() {
  const { id } = useParams()
  const { state, dispatch } = useAppState()
  const { requireLogin } = useAuthGate()
  const { addProject } = useComparison()
  const { pushToast } = useToast()
  const [bundle, setBundle] = useState<ProjectBundle | null>(null)
  const [error, setError] = useState<ServiceError | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    projectService.getBundle(id as Project['id'], { scenario: state.serviceScenario }).then((result) => {
      if (!active) return
      if (result.ok) {
        setBundle(result.data); setError(null)
        dispatch({ type: 'RECENT_PROJECT_ADD', projectId: result.data.project.id })
        dispatch({ type: 'EVENT_LOGGED', event: createPrototypeEvent('project_viewed', { projectId: result.data.project.id }) })
      } else setError(result.error)
      setLoading(false)
    })
    return () => { active = false }
  }, [dispatch, id, state.serviceScenario])

  if (loading) return <main className="page-container"><LoadingState label="作品档案加载中" /></main>
  if (error || !bundle) return <main className="page-container stack"><ErrorPanel message={error?.message ?? '未找到作品'} detail={error?.code} /><Link to="/projects">返回作品广场</Link></main>

  const { project, creators } = bundle
  const name = factText(project.currentName, '名称未知的作品')
  const status = project.accessStatus.state === 'known' ? project.accessStatus.value : 'unknown'
  const selected = state.comparisonProjectIds.includes(project.id)
  const favorited = state.favoriteProjectIds.includes(project.id)
  const followed = state.followedProjectIds.includes(project.id)
  const orderedFlow = project.coreFlow.state === 'known' ? [...project.coreFlow.value].sort((a, b) => a.order - b.order) : []

  function protectedToggle(kind: 'favorite' | 'follow') {
    requireLogin({ id: `${kind}-${project.id}`, kind, projectId: project.id, sourcePath: `/project/${project.id}` }, () => dispatch({ type: kind === 'favorite' ? 'FAVORITE_TOGGLE' : 'FOLLOW_TOGGLE', projectId: project.id }))
  }

  async function shareProject() {
    const shareText = `${name} · VibeCheck`
    try { await navigator.clipboard?.writeText(window.location.href) } catch { /* the prototype still provides visible share feedback */ }
    pushToast(`已准备分享：${shareText}`, 'success')
  }

  return (
    <main className="page-container page-with-bottom-space stack">
      <nav aria-label="面包屑"><Link to="/projects">作品广场</Link> / {name}</nav>
      <section className="project-hero">
        <div className="media-placeholder project-hero__media" aria-label={project.coverMedia[0]?.alt ?? `${name} 媒体占位`}>16:9 作品媒体占位</div>
        <div className="project-hero__content stack">
          <div className="cluster"><AccessStatusBadge status={status} /><FreshnessLabel status={project.freshnessStatus} lastVerifiedAt={project.lastVerifiedAt} /><CompletenessLabel level={project.completenessLevel} /></div>
          <div className="stack stack--small"><p className="eyebrow">Project profile</p><h1>{name}</h1>{project.oneLineDefinition.state === 'known' ? <p className="project-hero__definition">{project.oneLineDefinition.value}</p> : <UnknownFact reason={project.oneLineDefinition.reason} />}</div>

          <section className="project-source stack stack--small" aria-label="作者与来源">
            <div className="cluster cluster--between"><div><strong>{authorLinkLabels[project.authorLinkStatus]}</strong><p>{sourceLabels[project.recordSource]}</p></div>{creators.length ? <div className="cluster">{creators.map((creator) => <Link key={creator.id} to={`/creator/${creator.id}`}><Tag tone={creator.verificationStatus === 'verified' ? 'default' : 'dashed'}>{creator.displayName} · {creator.verificationStatus === 'verified' ? '已验证' : '未验证'}</Tag></Link>)}</div> : <span className="unknown-value">未发现已确认的公开作者</span>}</div>
            <Link className="weak-link" to={`/project/${project.id}/verify-author`}>我是作者，申请关联</Link>
          </section>

          <div className="project-primary-actions" aria-label="作品核心操作">
            {project.publicUrl.state === 'known' ? <ExternalLinkGuard href={project.publicUrl.value}>立即体验</ExternalLinkGuard> : <Button variant="primary" disabled>体验地址未知</Button>}
            <Button aria-pressed={favorited} onClick={() => protectedToggle('favorite')}>{favorited ? '已收藏' : '收藏'}</Button>
            <Button aria-pressed={followed} onClick={() => protectedToggle('follow')}>{followed ? '已关注更新' : '关注更新'}</Button>
            <Button onClick={shareProject}>分享</Button>
            <Button aria-pressed={selected} onClick={() => selected ? dispatch({ type: 'COMPARISON_REMOVE', projectId: project.id }) : addProject(project.id)}>{selected ? '移出比较' : '加入比较'}</Button>
          </div>
        </div>
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
    </main>
  )
}
