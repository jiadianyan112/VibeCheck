import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { Button, EmptyState, ErrorPanel, LoadingState, ProjectCard, ResponsiveFilterPanel, Tag, UnifiedSearchForm } from '../components'
import { isCompleteIdeaQuery, unifiedSearchPath, useAuthGate, useComparison } from '../features'
import { creatorsForProject, resolveServiceScenario } from '../mocks'
import { searchService, type SearchHit, type ServiceError } from '../services'
import { createPrototypeEvent, useAppState } from '../state'
import { accessStatuses, assetTypes, inputTypes, targetUsers, type AccessStatus, type AssetType, type InputType, type Project, type ProjectCategoryId, type TargetUser } from '../types'
import { accessStatusText, inputTypeLabels, targetUserLabels } from '../utils'

const assetLabels: Record<AssetType, string> = { source_code: '源代码', starter: 'Starter', template: '模板', component: '组件', page_layout: '页面布局', ui_component: 'UI 组件', motion_interaction: '动画/交互', theme_design_system: '主题/设计系统', resume_module: '简历模块', blog_cms_module: '博客/CMS 模块', prompt: '提示词', parsing_solution: '解析方案', open_api: '开放 API', deployment_solution: '部署方案', deployment_config: '部署配置', design_file: '设计稿', other: '其他' }

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q')?.trim() ?? ''
  const requestedMode = params.get('mode')
  const forceKeywordSearch = requestedMode === 'works'
  const shouldAnalyzeIdea = requestedMode === 'similar' || (isCompleteIdeaQuery(query) && !forceKeywordSearch)
  const { state, dispatch } = useAppState()
  const { requireLogin } = useAuthGate()
  const { addProject } = useComparison()
  const [hits, setHits] = useState<SearchHit[]>([])
  const [error, setError] = useState<ServiceError | null>(null)
  const [loading, setLoading] = useState(true)
  const scenario = resolveServiceScenario(params, state.serviceScenario)

  const filters = useMemo(() => ({
    categoryIds: params.get('category') ? [params.get('category') as ProjectCategoryId] : undefined,
    targetUsers: params.get('target') ? [params.get('target') as TargetUser] : undefined,
    inputs: params.get('input') ? [params.get('input') as InputType] : undefined,
    statuses: params.get('status') ? [params.get('status') as AccessStatus] : undefined,
    assetTypes: params.get('asset') ? [params.get('asset') as AssetType] : undefined,
  }), [params])

  useEffect(() => {
    if (shouldAnalyzeIdea) return
    let active = true
    setLoading(true)
    searchService.search(query, filters, { scenario }).then((result) => {
      if (!active) return
      if (result.ok) { setHits(result.data.hits); setError(null); dispatch({ type: 'EVENT_LOGGED', event: createPrototypeEvent('search_submitted', { query, resultCount: result.data.hits.length, mode: 'works' }) }) }
      else setError(result.error)
      setLoading(false)
    })
    return () => { active = false }
  }, [dispatch, filters, query, scenario, shouldAnalyzeIdea])

  const sorted = useMemo(() => {
    const sort = params.get('sort') ?? 'relevance'
    return [...hits].sort((a, b) => sort === 'recent' ? b.project.lastVerifiedAt.localeCompare(a.project.lastVerifiedAt) : sort === 'name' ? (a.project.currentName.state === 'known' ? a.project.currentName.value : '').localeCompare(b.project.currentName.state === 'known' ? b.project.currentName.value : '') : b.score - a.score)
  }, [hits, params])

  function setParam(key: string, value: string) { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next, { replace: true }) }
  function toggleFavorite(project: Project) { requireLogin({ id: `favorite-${project.id}`, kind: 'favorite', projectId: project.id, sourcePath: `/search?${params}` }, () => dispatch({ type: 'FAVORITE_TOGGLE', projectId: project.id })) }
  function resetFilters() { const next = new URLSearchParams(); if (query) next.set('q', query); if (forceKeywordSearch) next.set('mode', 'works'); setParams(next, { replace: true }) }

  if (shouldAnalyzeIdea) return <Navigate to={unifiedSearchPath(query)} replace />

  return (
    <main className="page-container page-with-bottom-space stack">
      <header className="search-header stack"><h1>{query ? `“${query}”的搜索结果` : '搜索作品、功能或完整想法'}</h1>
        {!query ? <p>搜作品或功能，也可以直接说说你想做什么。</p> : null}
        <UnifiedSearchForm key={query} id="result-query" className="hero-search" inputClassName="input" submitClassName="button button--primary" defaultValue={query} submitLabel="重新搜索" />
        {forceKeywordSearch && isCompleteIdeaQuery(query) ? <div className="mode-notice"><strong>暂时按关键词搜索</strong><span>我们没有完整识别这段想法，你也可以返回修改。</span><Link to={`/discover?idea=${encodeURIComponent(query)}`}>重新整理想法 →</Link></div> : null}
      </header>

      <section className="search-layout">
        <ResponsiveFilterPanel label="搜索筛选"><div className="cluster cluster--between"><h2>筛选</h2><Button variant="quiet" onClick={resetFilters}>重置</Button></div>
          <label className="field"><span className="field__label">作品品类</span><select className="input" value={params.get('category') ?? ''} onChange={(e) => setParam('category', e.target.value)}><option value="">全部品类</option><option value="ai_learning_quiz">AI 学习与题库</option><option value="personal_site_portfolio">个人主页与作品集</option></select></label>
          {params.get('category') !== 'personal_site_portfolio' ? <><label className="field"><span className="field__label">目标用户</span><select className="input" value={params.get('target') ?? ''} onChange={(e) => setParam('target', e.target.value)}><option value="">全部</option>{targetUsers.map((item) => <option key={item} value={item}>{targetUserLabels[item]}</option>)}</select></label><label className="field"><span className="field__label">材料输入</span><select className="input" value={params.get('input') ?? ''} onChange={(e) => setParam('input', e.target.value)}><option value="">全部</option>{inputTypes.map((item) => <option key={item} value={item}>{inputTypeLabels[item]}</option>)}</select></label></> : <p className="page-description">个人主页与作品集结果会根据作者身份、网站结构、视觉方向、实现方式和复用资产解释匹配。</p>}
          <label className="field"><span className="field__label">当前状态</span><select className="input" value={params.get('status') ?? ''} onChange={(e) => setParam('status', e.target.value)}><option value="">全部</option>{accessStatuses.map((item) => <option key={item} value={item}>{accessStatusText[item]}</option>)}</select></label>
          <label className="field"><span className="field__label">复用资产</span><select className="input" value={params.get('asset') ?? ''} onChange={(e) => setParam('asset', e.target.value)}><option value="">全部</option>{assetTypes.map((item) => <option key={item} value={item}>{assetLabels[item]}</option>)}</select></label>
          <label className="field"><span className="field__label">排序</span><select className="input" value={params.get('sort') ?? 'relevance'} onChange={(e) => setParam('sort', e.target.value)}><option value="relevance">匹配程度</option><option value="recent">最近核验</option><option value="name">名称</option></select></label>
        </ResponsiveFilterPanel>

        <div className="stack"><div className="cluster cluster--between"><h2>{loading ? '正在检索' : `${sorted.length} 个结果`}</h2></div>
          {loading ? <LoadingState label="正在搜索作品" /> : error ? <ErrorPanel message={error.message} /> : sorted.length ? <div className="search-results">{sorted.map((hit) => <div key={hit.project.id} className="search-hit"><div className="match-reason"><strong>为什么匹配</strong>{hit.matchedFields.map((field) => <Tag key={field}>{field}</Tag>)}</div><ProjectCard project={hit.project} creators={creatorsForProject(hit.project)} variant="compact" favorited={state.favoriteProjectIds.includes(hit.project.id)} selectedForCompare={state.comparisonProjectIds.includes(hit.project.id)} onToggleFavorite={toggleFavorite} onToggleCompare={(project) => state.comparisonProjectIds.includes(project.id) ? dispatch({ type: 'COMPARISON_REMOVE', projectId: project.id }) : addProject(project.id)} /></div>)}</div> : <EmptyState title="没有找到匹配的公开作品" description={query ? `暂时没有找到与“${query}”匹配的作品，可以换个说法试试。` : '搜作品或功能，也可以直接说说你想做什么。'} action={<div className="cluster"><Button onClick={() => setParams({}, { replace: true })}>清空条件</Button><Link className="button button--primary" to="/submit">发布作品</Link></div>} />}
        </div>
      </section>
    </main>
  )
}
