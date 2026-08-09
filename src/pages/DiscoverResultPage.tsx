import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, EmptyState, ErrorPanel, LoadingState, ProjectCard, Tabs, Tag, useToast } from '../components'
import { buildDiscoveryAnalysis, categoryCatalog, useComparison } from '../features'
import { creatorsForProject } from '../mocks'
import { projectService, type ServiceError } from '../services'
import { useAppState } from '../state'
import type { AccessStatus, AssetType, ComparisonIntent, CreatorRole, InputType, OutputType, PageModel, PracticeFormat, PrimaryGoal, Project, ProjectCategoryId, ReusableAsset, SiteType, TargetUser, UseScenario, VisualStyle } from '../types'
import { accessStatusText, inputTypeLabels, practiceFormatLabels, scenarioLabels, targetUserLabels } from '../utils'

type ResultView = 'works' | 'analysis'
const assetLabels: Record<AssetType | 'none', string> = { source_code: '源代码', starter: 'Starter', template: '模板', component: '组件', page_layout: '页面布局', ui_component: 'UI 组件', motion_interaction: '动画/交互', theme_design_system: '主题/设计系统', resume_module: '简历模块', blog_cms_module: '博客/CMS 模块', prompt: '提示词', parsing_solution: '解析方案', open_api: '开放 API', deployment_solution: '部署方案', deployment_config: '部署配置', design_file: '设计稿', other: '其他资产', none: '暂无公开资产' }
const siteTypeLabels: Record<SiteType, string> = { personal_homepage: '个人主页', portfolio: '作品集', online_resume: '在线简历', academic_homepage: '学术主页', hybrid: '混合站点' }
const creatorRoleLabels: Record<CreatorRole, string> = { developer: '开发者', designer: '设计师', product_manager: '产品经理', creator: '创作者', freelancer: '自由职业者', student_recruit: '学生/应届生', researcher_academic: '研究者/学者', multidisciplinary: '跨领域创作者', other: '其他' }
const primaryGoalLabels: Record<PrimaryGoal, string> = { showcase_projects: '展示项目', professional_presence: '职业形象', job_search: '求职', client_acquisition: '获取客户', personal_brand: '个人品牌', academic_profile: '学术档案', content_hub: '内容枢纽', other: '其他' }
const pageModelLabels: Record<PageModel, string> = { single_page: '单页', multi_page: '多页', hybrid: '混合结构' }
const visualStyleLabels: Record<VisualStyle, string> = { minimal: '极简', editorial: '编辑感', brutalist: '粗野主义', playful: '趣味', retro: '复古', corporate: '专业商务', experimental: '实验性', illustrative: '插画主导', photographic: '摄影主导', typographic: '字体主导', other: '其他' }

function intentFromParams(params: URLSearchParams): ComparisonIntent {
  return {
    originalQuery: params.get('idea') ?? '',
    categoryId: (params.get('category') || undefined) as ProjectCategoryId | undefined,
    targetUsers: params.getAll('target') as TargetUser[],
    useScenarios: params.getAll('scenario') as UseScenario[],
    inputs: params.getAll('input') as InputType[],
    practiceFormats: params.getAll('practice') as PracticeFormat[],
    outputs: params.getAll('output') as OutputType[],
    siteTypes: params.getAll('siteType') as SiteType[],
    creatorRoles: params.getAll('role') as CreatorRole[],
    primaryGoals: params.getAll('goal') as PrimaryGoal[],
    pageModels: params.getAll('pageModel') as PageModel[],
    visualStyles: params.getAll('visual') as VisualStyle[],
    assetTypes: params.getAll('assetType') as AssetType[],
  }
}

function projectName(project: Project) {
  return project.currentName.state === 'known' ? project.currentName.value : '名称未知的作品'
}

export function DiscoverResultPage() {
  const [params, setParams] = useSearchParams()
  const { state, dispatch } = useAppState()
  const { addProject } = useComparison()
  const { pushToast } = useToast()
  const [projects, setProjects] = useState<Project[]>([])
  const [assets, setAssets] = useState<ReusableAsset[]>([])
  const [error, setError] = useState<ServiceError | null>(null)
  const [loading, setLoading] = useState(true)
  const intent = useMemo(() => intentFromParams(params), [params])

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([
      projectService.list({ scenario: state.serviceScenario }),
      projectService.listAssets({ scenario: state.serviceScenario }),
    ]).then(([projectResult, assetResult]) => {
      if (!active) return
      const failed = !projectResult.ok ? projectResult.error : !assetResult.ok ? assetResult.error : null
      if (failed) setError(failed)
      else if (projectResult.ok && assetResult.ok) {
        setProjects(projectResult.data)
        setAssets(assetResult.data)
        setError(null)
      }
      setLoading(false)
    })
    return () => { active = false }
  }, [state.serviceScenario])

  const analysis = useMemo(() => buildDiscoveryAnalysis(projects, assets, intent), [assets, intent, projects])
  const hasResultFilters = Boolean(params.get('status') || params.get('asset'))
  const view = (params.get('view') as ResultView | null) ?? (analysis.exactProjects.length < 3 ? 'works' : 'analysis')
  const adjacentCategories = useMemo(() => categoryCatalog.map((category) => ({
    category,
    score: (intent.categoryId === category.projectCategoryId ? 5 : 0) + (category.scenario && intent.useScenarios.includes(category.scenario) ? 3 : 0) + (category.requirePdf && intent.inputs.includes('pdf') ? 1 : 0),
  })).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.category.slug.localeCompare(b.category.slug)).slice(0, 3), [intent.categoryId, intent.inputs, intent.useScenarios])
  const assetsByProject = useMemo(() => new Map(analysis.exactProjects.map((project) => [project.id, assets.filter((asset) => asset.projectId === project.id)])), [analysis.exactProjects, assets])
  const filteredProjects = useMemo(() => {
    const status = params.get('status') as AccessStatus | null
    const asset = params.get('asset') as AssetType | 'none' | null
    return analysis.exactProjects.filter((project) => {
      const projectStatus = project.accessStatus.state === 'known' ? project.accessStatus.value : 'unknown'
      const projectAssets = assetsByProject.get(project.id) ?? []
      return (!status || projectStatus === status)
        && (!asset || (asset === 'none' ? projectAssets.length === 0 : projectAssets.some(({ type }) => type === asset)))
    })
  }, [analysis.exactProjects, assetsByProject, params])

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value); else next.delete(key)
    setParams(next, { replace: true })
  }

  function openStatistic(kind: 'status' | 'asset', key: string) {
    const next = new URLSearchParams(params)
    next.set(kind, key)
    next.set('view', 'works')
    setParams(next, { replace: true })
  }

  function toggleCompare(project: Project) {
    if (state.comparisonProjectIds.includes(project.id)) dispatch({ type: 'COMPARISON_REMOVE', projectId: project.id })
    else addProject(project.id)
  }

  function clearResultFilters() {
    const next = new URLSearchParams(params)
    next.delete('status'); next.delete('asset')
    setParams(next, { replace: true })
  }

  function saveQuery() {
    const key = 'vibecheck:saved-discovery-queries'
    let saved: string[] = []
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown
      if (Array.isArray(stored) && stored.every((item) => typeof item === 'string')) saved = stored
    } catch { /* discard a malformed saved-query value */ }
    const path = `/discover/result?${params}`
    localStorage.setItem(key, JSON.stringify([...new Set([...saved, path])]))
    pushToast('已保存这次搜索，下次可以从相同链接继续。', 'success')
  }

  if (loading) return <main className="page-container"><LoadingState label="正在寻找匹配作品" /></main>
  if (error) return <main className="page-container"><ErrorPanel message={error.message} /></main>

  return (
    <main className="page-container page-with-bottom-space stack">
      <nav aria-label="面包屑"><Link to={`/discover?idea=${encodeURIComponent(intent.originalQuery)}`}>确认想法</Link> / 匹配结果</nav>
      <header className="analysis-hero stack stack--small">
        <h1>找到相似作品</h1>
        <p>围绕“{intent.originalQuery || '你的想法'}”，找到 <strong>{analysis.exactProjects.length}</strong> 个完全匹配的作品{analysis.exactProjects.length === 0 && analysis.relaxedProjects.length ? `，并整理了 ${analysis.relaxedProjects.length} 个相近参考` : ''}。</p>
        <div className="cluster" aria-label="已确认意图">
          <Tag tone="strong">{intent.categoryId === 'personal_site_portfolio' ? '个人主页与作品集' : 'AI 学习与题库'}</Tag>
          {intent.targetUsers.map((value) => <Tag key={`target-${value}`}>{targetUserLabels[value]}</Tag>)}
          {intent.useScenarios.map((value) => <Tag key={`scenario-${value}`}>{scenarioLabels[value]}</Tag>)}
          {intent.inputs.map((value) => <Tag key={`input-${value}`}>{inputTypeLabels[value]}</Tag>)}
          {intent.practiceFormats.map((value) => <Tag key={`practice-${value}`}>{practiceFormatLabels[value]}</Tag>)}
          {intent.siteTypes?.map((value) => <Tag key={`site-${value}`}>{siteTypeLabels[value]}</Tag>)}
          {intent.creatorRoles?.map((value) => <Tag key={`role-${value}`}>{creatorRoleLabels[value]}</Tag>)}
          {intent.primaryGoals?.map((value) => <Tag key={`goal-${value}`}>{primaryGoalLabels[value]}</Tag>)}
          {intent.pageModels?.map((value) => <Tag key={`page-${value}`}>{pageModelLabels[value]}</Tag>)}
          {intent.visualStyles?.map((value) => <Tag key={`visual-${value}`}>{visualStyleLabels[value]}</Tag>)}
          {intent.assetTypes?.map((value) => <Tag key={`asset-intent-${value}`}>希望复用：{assetLabels[value]}</Tag>)}
        </div>
        <aside className="boundary-note"><strong>关于这些结果</strong><p>结果来自社区目前收录的公开作品，用于发现和比较，不代表市场需求或商业机会。</p></aside>
      </header>

      <div className="cluster cluster--between">
        <Tabs label="结果视图" items={[{ id: 'works', label: '作品结果' }, { id: 'analysis', label: '同类分析' }]} value={view} onChange={(value) => setParam('view', value)} />
        <div className="cluster">
          {params.get('status') ? <Tag tone="dashed">状态：{accessStatusText[params.get('status') as AccessStatus]}</Tag> : null}
          {params.get('asset') ? <Tag tone="dashed">资产：{assetLabels[params.get('asset') as AssetType | 'none']}</Tag> : null}
          {hasResultFilters ? <Button variant="quiet" onClick={clearResultFilters}>清除统计筛选</Button> : null}
        </div>
      </div>

      {view === 'works' ? (
        <section className="analysis-works stack">
          <div className="result-tier result-tier--exact stack"><div className="cluster cluster--between"><div><Tag tone="strong">精确匹配</Tag><h2>精确匹配作品</h2></div><strong aria-live="polite">{filteredProjects.length} 个结果</strong></div>
            {filteredProjects.length ? <div className="compact-list">{filteredProjects.map((project) => <ProjectCard key={project.id} project={project} creators={creatorsForProject(project)} variant="compact" selectedForCompare={state.comparisonProjectIds.includes(project.id)} onToggleCompare={toggleCompare} />)}</div> : analysis.exactProjects.length ? <EmptyState title="当前筛选下没有精确作品" description="匹配作品仍在，可以清除统计筛选后查看。" action={<Button onClick={clearResultFilters}>清除统计筛选</Button>} /> : <EmptyState title="暂未找到同时满足全部条件的作品" description={analysis.relaxedProjects.length ? '已自动放宽部分条件，下面列出最接近的社区作品。' : '可以返回修改条件，或继续浏览相关专题。'} />}
          </div>

          {analysis.exactProjects.length < 3 && analysis.relaxedProjects.length ? <div className="result-tier result-tier--relaxed stack"><div><Tag tone="dashed">相近推荐</Tag><h2>{analysis.exactProjects.length === 0 ? '最接近的作品' : '相近作品'}</h2><p>{analysis.exactProjects.length === 0 ? '这些作品命中了部分已确认条件，但不满足全部要求；差异会明确标出，不会冒充精确结果。' : '这些作品只符合部分条件，可以作为补充参考。'}</p></div><div className="compact-list">{analysis.relaxedProjects.map(({ project, reason }) => <div key={project.id} className="relaxed-hit"><p><strong>推荐原因：</strong>{reason}</p><ProjectCard project={project} creators={creatorsForProject(project)} variant="compact" selectedForCompare={state.comparisonProjectIds.includes(project.id)} onToggleCompare={toggleCompare} /></div>)}</div></div> : null}

          {analysis.exactProjects.length === 0 ? <div className="result-tier result-tier--adjacent stack"><div><Tag tone="dashed">相关问题</Tag><h2>换个方向继续探索</h2><p>{intent.categoryId === 'personal_site_portfolio' ? '根据你确认的网站类型、创作者身份和建站目的，我们找到了相关专题。' : '根据你的使用场景和输入内容，我们找到了这些相关专题。'}</p></div>{adjacentCategories.length ? <div className="analysis-group-grid">{adjacentCategories.map(({ category }) => <article key={category.slug} className="wire-card stack stack--small"><strong>{category.name}</strong><p>{category.shortProblem}</p><Link to={`/categories/${category.slug}`}>查看相关专题 →</Link></article>)}</div> : <EmptyState title="暂时没有相关专题" description="可以返回上一步调整想法。" />}
            <div className="cluster"><Link className="button" to={`/discover?idea=${encodeURIComponent(intent.originalQuery)}`}>修改条件</Link>{hasResultFilters ? <Button onClick={clearResultFilters}>清除统计筛选</Button> : null}<Button variant="primary" onClick={saveQuery}>保存查询</Button><Link className="button button--quiet" to="/projects">回到作品广场</Link></div>
          </div> : null}
        </section>
      ) : (
        <div className="stack">
          {analysis.representative ? <section className="stack"><div className="section-heading"><h2>代表作品</h2><p>{analysis.representative.reason}</p></div><ProjectCard project={analysis.representative.project} creators={creatorsForProject(analysis.representative.project)} variant="compact" selectedForCompare={state.comparisonProjectIds.includes(analysis.representative.project.id)} onToggleCompare={toggleCompare} /></section> : null}

          <section className="stack"><div className="section-heading"><h2>常见做法</h2><p>{intent.categoryId === 'personal_site_portfolio' ? '看看这些作品采用了哪些网站类型、作者身份与建站目的。' : '看看这些作品采用了哪些场景、输入和练习方式。'}</p></div>
            {analysis.solutionGroups.length ? <div className="analysis-group-grid">{analysis.solutionGroups.map((group) => <article key={group.id} className="wire-card stack stack--small"><div className="cluster">{intent.categoryId === 'personal_site_portfolio' ? <><Tag>{siteTypeLabels[group.scenario as SiteType] ?? group.scenario}</Tag><Tag>{creatorRoleLabels[group.input as CreatorRole] ?? group.input}</Tag><Tag>{primaryGoalLabels[group.practice as PrimaryGoal] ?? group.practice}</Tag></> : <><Tag>{scenarioLabels[group.scenario as UseScenario] ?? group.scenario}</Tag><Tag>{inputTypeLabels[group.input as InputType] ?? group.input}</Tag><Tag>{practiceFormatLabels[group.practice as PracticeFormat] ?? group.practice}</Tag></>}</div><strong>{group.projectIds.length} 个作品</strong><ul>{group.projectIds.map((id) => { const project = projects.find((item) => item.id === id); return project ? <li key={id}><Link to={`/project/${id}`}>{projectName(project)}</Link></li> : null })}</ul></article>)}</div> : <EmptyState title="暂无可分组的精确作品" />}
          </section>

          <section className="distribution-grid">
            <div className="stack"><div className="section-heading"><h2>作品状态</h2></div>{analysis.statusDistribution.map((row) => <article key={row.key} className="stat-trace"><Button onClick={() => openStatistic('status', row.key)}>{accessStatusText[row.key as AccessStatus]} · {row.count}</Button><details><summary>查看包含的作品</summary><ul>{row.projectIds.map((id) => { const project = projects.find((item) => item.id === id); return project ? <li key={id}><Link to={`/project/${id}`}>{projectName(project)}</Link></li> : null })}</ul></details></article>)}</div>
            <div className="stack"><div className="section-heading"><h2>可复用内容</h2></div>{analysis.assetDistribution.map((row) => <article key={row.key} className="stat-trace"><Button onClick={() => openStatistic('asset', row.key)}>{assetLabels[row.key]} · {row.count}</Button><details><summary>查看包含的作品</summary><ul>{row.projectIds.map((id) => { const project = projects.find((item) => item.id === id); return project ? <li key={id}><Link to={`/project/${id}`}>{projectName(project)}</Link></li> : null })}</ul></details></article>)}</div>
          </section>
        </div>
      )}
    </main>
  )
}
