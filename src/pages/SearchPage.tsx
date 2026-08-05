import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, EmptyState, ErrorPanel, LoadingState, ProjectCard, Tabs, Tag } from '../components'
import { useAuthGate, useComparison } from '../features'
import { resolveServiceScenario } from '../mocks'
import { searchService, type SearchHit, type ServiceError } from '../services'
import { createPrototypeEvent, useAppState } from '../state'
import { accessStatuses, assetTypes, inputTypes, targetUsers, type AccessStatus, type AssetType, type InputType, type Project, type TargetUser } from '../types'
import { accessStatusText, inputTypeLabels, targetUserLabels } from '../utils'

type SearchMode = 'works' | 'similar'
const assetLabels: Record<AssetType, string> = { source_code: '源代码', template: '模板', component: '组件', prompt: '提示词', parsing_solution: '解析方案', open_api: '开放 API', deployment_solution: '部署方案', other: '其他' }

export function inferSearchMode(query: string): SearchMode {
  return query.trim().length > 14 ? 'similar' : 'works'
}

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q')?.trim() ?? ''
  const mode = (params.get('mode') as SearchMode | null) ?? inferSearchMode(query)
  const { state, dispatch } = useAppState()
  const { requireLogin } = useAuthGate()
  const { addProject } = useComparison()
  const [hits, setHits] = useState<SearchHit[]>([])
  const [error, setError] = useState<ServiceError | null>(null)
  const [loading, setLoading] = useState(true)
  const scenario = resolveServiceScenario(params, state.serviceScenario)

  const filters = useMemo(() => ({
    targetUsers: params.get('target') ? [params.get('target') as TargetUser] : undefined,
    inputs: params.get('input') ? [params.get('input') as InputType] : undefined,
    statuses: params.get('status') ? [params.get('status') as AccessStatus] : undefined,
    assetTypes: params.get('asset') ? [params.get('asset') as AssetType] : undefined,
  }), [params])

  useEffect(() => {
    let active = true
    setLoading(true)
    searchService.search(query, filters, { scenario }).then((result) => {
      if (!active) return
      if (result.ok) { setHits(result.data.hits); setError(null); dispatch({ type: 'EVENT_LOGGED', event: createPrototypeEvent('search_submitted', { query, resultCount: result.data.hits.length, mode }) }) }
      else setError(result.error)
      setLoading(false)
    })
    return () => { active = false }
  }, [dispatch, filters, mode, query, scenario])

  const sorted = useMemo(() => {
    const sort = params.get('sort') ?? 'relevance'
    return [...hits].sort((a, b) => sort === 'recent' ? b.project.lastVerifiedAt.localeCompare(a.project.lastVerifiedAt) : sort === 'name' ? (a.project.currentName.state === 'known' ? a.project.currentName.value : '').localeCompare(b.project.currentName.state === 'known' ? b.project.currentName.value : '') : b.score - a.score)
  }, [hits, params])

  function setParam(key: string, value: string) { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next, { replace: true }) }
  function protectedToggle(kind: 'favorite' | 'follow', project: Project) { requireLogin({ id: `${kind}-${project.id}`, kind, projectId: project.id, sourcePath: `/search?${params}` }, () => dispatch({ type: kind === 'favorite' ? 'FAVORITE_TOGGLE' : 'FOLLOW_TOGGLE', projectId: project.id })) }

  return (
    <main className="page-container page-with-bottom-space stack">
      <header className="search-header stack"><p className="eyebrow">Unified search</p><h1>{query ? `“${query}”的搜索结果` : '搜索公开作品或一个完整想法'}</h1>
        <form action="/search" method="get" role="search" className="hero-search"><label className="sr-only" htmlFor="result-query">搜索内容</label><input key={query} id="result-query" className="input" name="q" defaultValue={query} placeholder="作品名、功能词或完整产品想法" /><input type="hidden" name="mode" value={mode} /><Button type="submit" variant="primary">重新搜索</Button></form>
        <Tabs label="搜索模式" items={[{ id: 'works', label: '搜作品' }, { id: 'similar', label: '查同类' }]} value={mode} onChange={(value) => setParam('mode', value)} />
        {mode === 'similar' ? <div className="mode-notice"><strong>正在显示可解释的关键词初筛</strong><span>下一步可确认目标用户、场景、输入、练习形式和输出。</span><Link to={`/discover?idea=${encodeURIComponent(query)}`}>确认完整意图 →</Link></div> : null}
      </header>

      <section className="search-layout">
        <aside className="filter-panel stack" aria-label="搜索筛选"><div className="cluster cluster--between"><h2>筛选</h2><Button variant="quiet" onClick={() => setParams({ q: query, mode }, { replace: true })}>重置</Button></div>
          <label className="field"><span className="field__label">目标用户</span><select className="input" value={params.get('target') ?? ''} onChange={(e) => setParam('target', e.target.value)}><option value="">全部</option>{targetUsers.map((item) => <option key={item} value={item}>{targetUserLabels[item]}</option>)}</select></label>
          <label className="field"><span className="field__label">材料输入</span><select className="input" value={params.get('input') ?? ''} onChange={(e) => setParam('input', e.target.value)}><option value="">全部</option>{inputTypes.map((item) => <option key={item} value={item}>{inputTypeLabels[item]}</option>)}</select></label>
          <label className="field"><span className="field__label">当前状态</span><select className="input" value={params.get('status') ?? ''} onChange={(e) => setParam('status', e.target.value)}><option value="">全部</option>{accessStatuses.map((item) => <option key={item} value={item}>{accessStatusText[item]}</option>)}</select></label>
          <label className="field"><span className="field__label">复用资产</span><select className="input" value={params.get('asset') ?? ''} onChange={(e) => setParam('asset', e.target.value)}><option value="">全部</option>{assetTypes.map((item) => <option key={item} value={item}>{assetLabels[item]}</option>)}</select></label>
          <label className="field"><span className="field__label">排序</span><select className="input" value={params.get('sort') ?? 'relevance'} onChange={(e) => setParam('sort', e.target.value)}><option value="relevance">匹配程度</option><option value="recent">最近核验</option><option value="name">名称</option></select></label>
        </aside>

        <div className="stack"><div className="cluster cluster--between"><div><p className="eyebrow">Results</p><h2>{loading ? '正在检索' : `${sorted.length} 个结果`}</h2></div>{query ? <Tag tone="dashed">查询参数已写入 URL</Tag> : null}</div>
          {loading ? <LoadingState label="搜索结果加载中" /> : error ? <ErrorPanel message={error.message} detail={error.code} /> : sorted.length ? <div className="search-results">{sorted.map((hit) => <div key={hit.project.id} className="search-hit"><div className="match-reason"><strong>为什么匹配</strong>{hit.matchedFields.map((field) => <Tag key={field}>{field}</Tag>)}</div><ProjectCard project={hit.project} variant="compact" favorited={state.favoriteProjectIds.includes(hit.project.id)} followed={state.followedProjectIds.includes(hit.project.id)} selectedForCompare={state.comparisonProjectIds.includes(hit.project.id)} onToggleFavorite={(project) => protectedToggle('favorite', project)} onToggleFollow={(project) => protectedToggle('follow', project)} onToggleCompare={(project) => state.comparisonProjectIds.includes(project.id) ? dispatch({ type: 'COMPARISON_REMOVE', projectId: project.id }) : addProject(project.id)} /></div>)}</div> : <EmptyState title="没有找到匹配的公开作品" description={query ? `“${query}”没有命中当前固定数据集。可以缩短关键词、切换查同类，或提交新作品。` : '请输入作品名、功能词或完整想法。'} action={<div className="cluster"><Button onClick={() => setParams({ q: '', mode: 'works' })}>清空条件</Button><Link className="button button--primary" to="/submit">发布作品</Link></div>} />}
        </div>
      </section>
    </main>
  )
}
