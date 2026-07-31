import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, EmptyState, ErrorPanel, LoadingState, ProjectCard, Tabs, Tag } from '../components'
import { buildDiscoveryAnalysis, useComparison } from '../features'
import { projectService, type ServiceError } from '../services'
import { useAppState } from '../state'
import type { AccessStatus, AssetType, ComparisonIntent, InputType, OutputType, PracticeFormat, Project, ReusableAsset, TargetUser, UseScenario } from '../types'
import { accessStatusText, inputTypeLabels, practiceFormatLabels, scenarioLabels, targetUserLabels } from '../utils'

type ResultView = 'works' | 'analysis'
const assetLabels: Record<AssetType | 'none', string> = { source_code: '源代码', template: '模板', component: '组件', prompt: '提示词', parsing_solution: '解析方案', open_api: '开放 API', deployment_solution: '部署方案', other: '其他资产', none: '暂无公开资产' }

function intentFromParams(params: URLSearchParams): ComparisonIntent {
  return {
    originalQuery: params.get('idea') ?? '',
    targetUsers: params.getAll('target') as TargetUser[],
    useScenarios: params.getAll('scenario') as UseScenario[],
    inputs: params.getAll('input') as InputType[],
    practiceFormats: params.getAll('practice') as PracticeFormat[],
    outputs: params.getAll('output') as OutputType[],
  }
}

function projectName(project: Project) {
  return project.currentName.state === 'known' ? project.currentName.value : '名称未知的作品'
}

export function DiscoverResultPage() {
  const [params, setParams] = useSearchParams()
  const { state, dispatch } = useAppState()
  const { addProject } = useComparison()
  const [projects, setProjects] = useState<Project[]>([])
  const [assets, setAssets] = useState<ReusableAsset[]>([])
  const [error, setError] = useState<ServiceError | null>(null)
  const [loading, setLoading] = useState(true)
  const intent = useMemo(() => intentFromParams(params), [params])
  const view = (params.get('view') as ResultView | null) ?? 'analysis'

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

  if (loading) return <main className="page-container"><LoadingState label="同类作品与资产统计中" /></main>
  if (error) return <main className="page-container"><ErrorPanel message={error.message} detail={error.code} /></main>

  return (
    <main className="page-container page-with-bottom-space stack">
      <nav aria-label="面包屑"><Link to={`/discover?idea=${encodeURIComponent(intent.originalQuery)}`}>意图确认</Link> / 同类分析</nav>
      <header className="analysis-hero stack stack--small">
        <p className="eyebrow">Similar solutions</p>
        <h1>同类作品分析</h1>
        <p>“{intent.originalQuery || '未命名查询'}”在当前固定数据集中有 <strong>{analysis.exactProjects.length}</strong> 个精确匹配作品。</p>
        <div className="cluster" aria-label="已确认意图">
          {intent.targetUsers.map((value) => <Tag key={`target-${value}`}>{targetUserLabels[value]}</Tag>)}
          {intent.useScenarios.map((value) => <Tag key={`scenario-${value}`}>{scenarioLabels[value]}</Tag>)}
          {intent.inputs.map((value) => <Tag key={`input-${value}`}>{inputTypeLabels[value]}</Tag>)}
          {intent.practiceFormats.map((value) => <Tag key={`practice-${value}`}>{practiceFormatLabels[value]}</Tag>)}
        </div>
        <aside className="boundary-note"><strong>判断边界</strong><p>下列数量只表示 VibeCheck 当前固定收录样本，不代表市场规模、竞争强度或真实需求大小；每项统计均可回溯到具体作品。</p></aside>
      </header>

      <div className="cluster cluster--between">
        <Tabs label="结果视图" items={[{ id: 'works', label: '作品结果' }, { id: 'analysis', label: '同类分析' }]} value={view} onChange={(value) => setParam('view', value)} />
        <div className="cluster">
          {params.get('status') ? <Tag tone="dashed">状态：{accessStatusText[params.get('status') as AccessStatus]}</Tag> : null}
          {params.get('asset') ? <Tag tone="dashed">资产：{assetLabels[params.get('asset') as AssetType | 'none']}</Tag> : null}
          {(params.get('status') || params.get('asset')) ? <Button variant="quiet" onClick={() => { const next = new URLSearchParams(params); next.delete('status'); next.delete('asset'); setParams(next, { replace: true }) }}>清除统计筛选</Button> : null}
        </div>
      </div>

      {view === 'works' ? (
        <section className="analysis-works stack">
          <div className="cluster cluster--between"><h2>精确匹配作品</h2><strong aria-live="polite">{filteredProjects.length} 个结果</strong></div>
          {filteredProjects.length ? <div className="compact-list">{filteredProjects.map((project) => <ProjectCard key={project.id} project={project} variant="compact" selectedForCompare={state.comparisonProjectIds.includes(project.id)} onToggleCompare={toggleCompare} />)}</div> : <EmptyState title="当前统计筛选下没有作品" description="清除状态或资产筛选即可回到完整精确结果。" action={<Button onClick={() => { const next = new URLSearchParams(params); next.delete('status'); next.delete('asset'); setParams(next, { replace: true }) }}>清除统计筛选</Button>} />}
        </section>
      ) : (
        <div className="stack">
          {analysis.representative ? <section className="stack"><div className="section-heading"><p className="eyebrow">Representative</p><h2>代表作品</h2><p>{analysis.representative.reason}</p></div><ProjectCard project={analysis.representative.project} variant="compact" selectedForCompare={state.comparisonProjectIds.includes(analysis.representative.project.id)} onToggleCompare={toggleCompare} /></section> : null}

          <section className="stack"><div className="section-heading"><p className="eyebrow">Solution groups</p><h2>方案分组</h2><p>按每个作品结构化字段中的首个场景、输入和练习形式归组。</p></div>
            {analysis.solutionGroups.length ? <div className="analysis-group-grid">{analysis.solutionGroups.map((group) => <article key={group.id} className="wire-card stack stack--small"><div className="cluster"><Tag>{scenarioLabels[group.scenario as UseScenario] ?? group.scenario}</Tag><Tag>{inputTypeLabels[group.input as InputType] ?? group.input}</Tag><Tag>{practiceFormatLabels[group.practice as PracticeFormat] ?? group.practice}</Tag></div><strong>{group.projectIds.length} 个作品</strong><ul>{group.projectIds.map((id) => { const project = projects.find((item) => item.id === id); return project ? <li key={id}><Link to={`/project/${id}`}>{projectName(project)}</Link></li> : null })}</ul></article>)}</div> : <EmptyState title="暂无可分组的精确作品" />}
          </section>

          <section className="distribution-grid">
            <div className="stack"><div className="section-heading"><p className="eyebrow">Current status</p><h2>状态分布</h2></div>{analysis.statusDistribution.map((row) => <article key={row.key} className="stat-trace"><Button onClick={() => openStatistic('status', row.key)}>{accessStatusText[row.key as AccessStatus]} · {row.count}</Button><details><summary>查看统计来源</summary><ul>{row.projectIds.map((id) => { const project = projects.find((item) => item.id === id); return project ? <li key={id}><Link to={`/project/${id}`}>{projectName(project)}</Link></li> : null })}</ul></details></article>)}</div>
            <div className="stack"><div className="section-heading"><p className="eyebrow">Reusable assets</p><h2>资产分布</h2></div>{analysis.assetDistribution.map((row) => <article key={row.key} className="stat-trace"><Button onClick={() => openStatistic('asset', row.key)}>{assetLabels[row.key]} · {row.count}</Button><details><summary>查看统计来源</summary><ul>{row.projectIds.map((id) => { const project = projects.find((item) => item.id === id); return project ? <li key={id}><Link to={`/project/${id}`}>{projectName(project)}</Link></li> : null })}</ul></details></article>)}</div>
          </section>
        </div>
      )}
    </main>
  )
}
