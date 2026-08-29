import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  EditorialHero,
  ErrorPanel,
  LoadingState,
  MarqueeStrip,
  ProjectCard,
  ProjectMediaStage,
  Reveal,
  SectionLead,
  UnifiedSearchForm,
} from '../components'
import { useAuthGate, useComparison } from '../features'
import { creatorsForProject } from '../mocks'
import { projectService, type ServiceError } from '../services'
import { createPrototypeEvent, useAppState } from '../state'
import type { Project } from '../types'

const problemLinks = [
  { slug: 'ai-question-generation', label: '把材料变成题目', hint: 'AI 出题与练习生成' },
  { slug: 'pdf-to-quiz', label: '把 PDF 变成题库', hint: '文档解析与答题流程' },
  { slug: 'speaking-practice', label: '练习并评价口语', hint: '录音、模考与分项反馈' },
  { slug: 'vocabulary-review', label: '记住词汇并安排复习', hint: '卡片、听写与间隔复习' },
]

function knownName(project: Project) {
  return project.currentName.state === 'known' ? project.currentName.value : '名称未知的作品'
}

function sectionAction(body: ReactNode, action?: ReactNode) {
  return (
    <>
      {action}
      <Reveal className="home-section__body">{body}</Reveal>
    </>
  )
}

export function ProjectsHomePage() {
  const { state, dispatch } = useAppState()
  const { requireLogin } = useAuthGate()
  const { addProject } = useComparison()
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState<ServiceError | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    dispatch({ type: 'EVENT_LOGGED', event: createPrototypeEvent('home_viewed') })
  }, [dispatch])

  useEffect(() => {
    let active = true
    setLoading(true)
    projectService.list({ scenario: state.serviceScenario }).then((result) => {
      if (!active) return
      if (result.ok) {
        setProjects(result.data)
        setError(null)
      } else {
        setError(result.error)
      }
      setLoading(false)
    })
    return () => { active = false }
  }, [state.serviceScenario])

  const sections = useMemo(() => ({
    curated: projects.filter((item) => item.categoryId === 'ai_learning_quiz' && item.completenessLevel === 'complete').slice(0, 3),
    portfolios: projects.filter((item) => item.categoryId === 'personal_site_portfolio').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4),
    latest: [...projects].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4),
    updated: [...projects].sort((a, b) => b.lastVerifiedAt.localeCompare(a.lastVerifiedAt)).slice(0, 4),
    reusable: projects.filter((item) => item.assetIds.length > 0 && item.accessStatus.state === 'known' && item.accessStatus.value !== 'ended').slice(0, 4),
    endedReusable: projects.filter((item) => item.assetIds.length > 0 && item.accessStatus.state === 'known' && item.accessStatus.value === 'ended'),
  }), [projects])

  function toggleFavorite(project: Project) {
    const action = { id: `favorite-${project.id}`, kind: 'favorite', projectId: project.id, sourcePath: '/projects' } as const
    requireLogin(action, () => dispatch({ type: 'FAVORITE_TOGGLE', projectId: project.id }))
  }

  const renderCompact = (project: Project) => (
    <ProjectCard
      key={project.id}
      project={project}
      creators={creatorsForProject(project)}
      variant="compact"
      selectedForCompare={state.comparisonProjectIds.includes(project.id)}
      onToggleCompare={(item) => state.comparisonProjectIds.includes(item.id) ? dispatch({ type: 'COMPARISON_REMOVE', projectId: item.id }) : addProject(item.id)}
    />
  )

  if (loading) return <main className="highfi-scope page-container home-state"><LoadingState label="作品广场加载中" /></main>
  if (error) return <main className="highfi-scope page-container home-state"><ErrorPanel message={error.message} onRetry={() => dispatch({ type: 'SCENARIO_SET', scenario: 'default' })} /></main>

  return (
    <main className="highfi-scope home-page">
      <EditorialHero
        className="home-editorial-hero"
        eyebrow="Vibe Coding 作品社区"
        title={<><span className="sr-only">先看看别人怎么做，再决定自己怎么做。</span><span aria-hidden="true">先看看别人怎么做，</span><br aria-hidden="true" /><span aria-hidden="true">再决定自己怎么做。</span></>}
        description="发现 Vibe Coding 作品、创作者和构建工具，找到可以借鉴的实现。"
        label="作品广场首屏"
        actions={<><Link className="button button--accent" to="#editor-picks">探索作品</Link><Link className="button button--secondary" to={state.session.user ? '/submit' : '/auth?return_to=%2Fsubmit'}>发布作品</Link></>}
        artwork={
          <div className="home-artwork-frame">
            <label className="sr-only" htmlFor="home-artwork-stage">本周作品舞台</label>
            <output id="home-artwork-stage" className="home-artwork">
              {sections.latest.slice(0, 3).map((project, index) => (
                <ProjectMediaStage
                  key={project.id}
                  media={project.coverMedia[0]}
                  projectId={project.id}
                  title={knownName(project)}
                  tone={index === 0 ? 'lime' : index === 1 ? 'cyan' : 'violet'}
                  priority={index === 0}
                />
              ))}
            </output>
          </div>
        }
      >
        <div className="home-hero-tools">
          <UnifiedSearchForm id="home-search" className="hero-search" inputClassName="input" submitClassName="button button--accent" placeholder="搜索作品、功能，或描述完整想法" />
          <div className="cluster" aria-label="快捷问题">{['PDF 出题', '口语模拟评分', '开发者作品集', '极简个人主页'].map((query) => <Link key={query} className="tag" to={`/search?q=${encodeURIComponent(query)}`}>{query}</Link>)}</div>
        </div>
      </EditorialHero>

      <SectionLead
        className="home-section home-section--muted"
        eyebrow="新增品类"
        title="个人主页与作品集"
        description="按身份、建站目的、内容结构、视觉方向和复用资产寻找参考；原有 AI 学习工具品类继续保留。"
        action={sectionAction(
          <div className="compact-list">{sections.portfolios.map(renderCompact)}</div>,
          <Link className="home-section__link" to="/categories/personal-sites-portfolios">进入品类专题 →</Link>,
        )}
      />

      <div id="editor-picks" className="home-editor-picks-anchor">
        <SectionLead
          className="home-section"
          title="编辑精选"
          description="从值得参考的作品开始，看看创作者是怎么做的。"
          id="editor-picks-heading"
          action={sectionAction(
            <div className="home-editor-picks-grid">
              {sections.curated.map((project, index) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  creators={creatorsForProject(project)}
                  variant={index === 0 ? 'featured' : 'standard'}
                  favorited={state.favoriteProjectIds.includes(project.id)}
                  selectedForCompare={state.comparisonProjectIds.includes(project.id)}
                  onToggleFavorite={toggleFavorite}
                  onToggleCompare={(item) => state.comparisonProjectIds.includes(item.id) ? dispatch({ type: 'COMPARISON_REMOVE', projectId: item.id }) : addProject(item.id)}
                />
              ))}
            </div>,
          )}
        />
      </div>

      <SectionLead
        className="home-section home-section--muted home-section--latest"
        title="最新发布"
        action={sectionAction(
          <MarqueeStrip label="最新发布作品">{sections.latest.map(renderCompact)}</MarqueeStrip>,
        )}
      />

      <SectionLead
        className="home-section"
        title="最近更新"
        description="看看近期有新版本或状态变化的作品。"
        action={sectionAction(<div className="compact-list">{sections.updated.map(renderCompact)}</div>)}
      />

      <SectionLead
        className="home-section home-section--muted"
        title="开源可复用"
        action={sectionAction(<div className="compact-list">{sections.reusable.map(renderCompact)}</div>)}
      />

      <SectionLead
        className="home-section"
        title="按问题与品类探索"
        action={sectionAction(
          <div className="problem-grid">
            <Link className="wire-card stack stack--small" to="/categories/personal-sites-portfolios"><strong>设计个人主页与作品集</strong><span>身份、结构、视觉与复用资产</span><span>查看新品类 →</span></Link>
            {problemLinks.map((item) => <Link key={item.slug} className="wire-card stack stack--small" to={`/categories/${item.slug}`}><strong>{item.label}</strong><span>{item.hint}</span><span>查看专题 →</span></Link>)}
          </div>,
        )}
      />

      <SectionLead
        className="home-section home-section--muted"
        title="已结束，但仍可复用"
        description="即使作品停止维护，其中的代码、模板或组件仍可能值得参考。"
        action={sectionAction(sections.endedReusable.length ? <div className="compact-list">{sections.endedReusable.map(renderCompact)}</div> : <p>暂无符合条件的公开档案。</p>)}
      />

      <section className="home-explainer page-container">
        <Reveal className="home-explainer__inner">
          <div><strong>信息更新有迹可循</strong><p>作品状态、历史和来源会分别记录，暂时无法确认的信息会明确标出。</p></div>
          <div><strong>发现自己的作品？</strong><p>如需维护已有档案，可在详情页申请作者身份验证。</p></div>
          <Link className="home-explainer__link" to="/about">了解收录与验证方式 →</Link>
        </Reveal>
      </section>
      <span className="sr-only">本页共展示 {projects.length} 个作品，首个为 {projects[0] ? knownName(projects[0]) : '无'}。</span>
    </main>
  )
}
