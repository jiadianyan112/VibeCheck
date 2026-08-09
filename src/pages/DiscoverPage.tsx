import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, ErrorPanel, LoadingState, Tag } from '../components'
import { inferIdeaCategory, IntentEditor } from '../features'
import { intentService, type IntentParseResult, type ServiceError } from '../services'
import { createPrototypeEvent, useAppState } from '../state'
import type { ComparisonIntent } from '../types'

function emptyIntent(originalQuery: string): ComparisonIntent { return { originalQuery, categoryId: inferIdeaCategory(originalQuery), targetUsers: [], useScenarios: [], inputs: [], practiceFormats: [], outputs: [], siteTypes: [], creatorRoles: [], primaryGoals: [], pageModels: [], visualStyles: [], assetTypes: [] } }
function hasAnyIntent(intent: ComparisonIntent) {
  if (!intent.categoryId) return false
  if (intent.categoryId === 'personal_site_portfolio') return [intent.siteTypes, intent.creatorRoles, intent.primaryGoals, intent.pageModels, intent.visualStyles, intent.assetTypes].some((values) => (values?.length ?? 0) > 0)
  return intent.targetUsers.length + intent.useScenarios.length + intent.inputs.length + intent.practiceFormats.length + intent.outputs.length > 0
}
function storageKey(text: string) { return `vibecheck:intent-draft:${encodeURIComponent(text)}` }

export function DiscoverPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const idea = params.get('idea') ?? ''
  const { state, dispatch } = useAppState()
  const [draftText, setDraftText] = useState(idea)
  const [parseResult, setParseResult] = useState<IntentParseResult | null>(null)
  const [originalIntent, setOriginalIntent] = useState<ComparisonIntent>(emptyIntent(idea))
  const [intent, setIntent] = useState<ComparisonIntent>(emptyIntent(idea))
  const [error, setError] = useState<ServiceError | null>(null)
  const [loading, setLoading] = useState(Boolean(idea))
  const [readyToPersist, setReadyToPersist] = useState(false)

  useEffect(() => setDraftText(idea), [idea])

  useEffect(() => {
    setReadyToPersist(false)
    if (!idea) { setParseResult(null); setIntent(emptyIntent('')); setOriginalIntent(emptyIntent('')); setLoading(false); return }
    let active = true
    setLoading(true)
    intentService.parse(idea, { scenario: state.serviceScenario }).then((result) => {
      if (!active) return
      if (!result.ok) {
        setError(result.error)
        setParseResult(null)
        setIntent((current) => current.originalQuery === idea ? current : emptyIntent(idea))
        setReadyToPersist(true)
      }
      else {
        const parsed = result.data
        setParseResult(parsed); setOriginalIntent(parsed.intent); setError(null)
        const saved = sessionStorage.getItem(storageKey(idea))
        if (saved) { try { setIntent(JSON.parse(saved) as ComparisonIntent) } catch { setIntent(parsed.intent) } } else setIntent(parsed.intent)
        setReadyToPersist(true)
      }
      setLoading(false)
    })
    return () => { active = false }
  }, [idea, state.serviceScenario])

  useEffect(() => { if (readyToPersist && idea && intent.originalQuery === idea) sessionStorage.setItem(storageKey(idea), JSON.stringify(intent)) }, [idea, intent, readyToPersist])

  const confidenceText = useMemo(() => parseResult?.confidence === 'high' ? '信息较完整' : parseResult?.confidence === 'medium' ? '建议核对' : '需要补充', [parseResult])

  function beginParse() { const next = draftText.trim(); if (next) navigate(`/discover?idea=${encodeURIComponent(next)}`) }
  function confirm() {
    if (!hasAnyIntent(intent)) return
    const next = new URLSearchParams({ idea: intent.originalQuery })
    if (intent.categoryId) next.set('category', intent.categoryId)
    intent.targetUsers.forEach((v) => next.append('target', v)); intent.useScenarios.forEach((v) => next.append('scenario', v)); intent.inputs.forEach((v) => next.append('input', v)); intent.practiceFormats.forEach((v) => next.append('practice', v)); intent.outputs.forEach((v) => next.append('output', v))
    intent.siteTypes?.forEach((v) => next.append('siteType', v)); intent.creatorRoles?.forEach((v) => next.append('role', v)); intent.primaryGoals?.forEach((v) => next.append('goal', v)); intent.pageModels?.forEach((v) => next.append('pageModel', v)); intent.visualStyles?.forEach((v) => next.append('visual', v)); intent.assetTypes?.forEach((v) => next.append('assetType', v))
    dispatch({ type: 'EVENT_LOGGED', event: createPrototypeEvent('intent_confirmed', { idea: intent.originalQuery }) })
    navigate(`/discover/result?${next}`)
  }

  if (!idea) return <Navigate to="/search" replace />

  return (
    <main className="page-container page-with-bottom-space stack">
      <header className="page-intro stack stack--small"><h1>一起把想法说清楚</h1><p>先确认作品品类，再核对真正影响查同类的条件。</p></header>
      <section className="idea-query-summary stack stack--small" aria-labelledby="original-idea-heading"><strong id="original-idea-heading">原始想法</strong><p>{idea}</p></section>
      <details className="idea-input-panel idea-input-panel--collapsible"><summary>修改原始想法</summary><div className="stack"><label className="field"><span className="field__label">完整产品想法</span><textarea className="input textarea" rows={4} value={draftText} onChange={(event) => setDraftText(event.target.value)} placeholder="例如：我想把大学 PDF 讲义生成选择题和简答题" /></label><div className="cluster"><Button variant="primary" disabled={!draftText.trim()} onClick={beginParse}>重新整理这段想法</Button><Button variant="quiet" onClick={() => { setDraftText(idea) }}>恢复当前文本</Button></div></div></details>

      {loading ? <LoadingState label="正在整理你的想法" /> : error ? <section className="stack"><ErrorPanel message={error.message} onRetry={beginParse} /><aside className="fallback-panel stack"><h2>暂时无法自动整理这段想法</h2><p>原始内容已经保留。你可以先看关键词结果，也可以在下方自己补充信息。</p><div className="cluster"><Link className="button" to={`/search?q=${encodeURIComponent(idea)}&mode=works`}>查看关键词结果</Link><a className="button button--quiet" href="#manual-intent">自己补充信息</a></div><div id="manual-intent"><IntentEditor value={intent} onChange={setIntent} /></div><Button variant="primary" disabled={!hasAnyIntent(intent)} onClick={confirm}>使用这些信息查找作品</Button>{!hasAnyIntent(intent) ? <p className="field__error" role="alert">请至少添加一个标签后继续。</p> : null}</aside></section> : idea && parseResult ? <section className="stack">
        <div className={`parse-notice parse-notice--${parseResult.status}`} role="status"><div className="cluster"><Tag tone={parseResult.confidence === 'high' ? 'default' : 'dashed'}>{confidenceText}</Tag><strong>{parseResult.status === 'failed' ? '还需要一些信息' : parseResult.status === 'partial' ? '还有信息待补充' : '想法已整理'}</strong></div><p>{parseResult.message}</p></div>
        <IntentEditor value={intent} onChange={setIntent} />
        <div className="cluster cluster--between"><Button onClick={() => setIntent(originalIntent)}>撤销修改</Button><div className="cluster"><Button variant="quiet" onClick={() => navigate(`/search?q=${encodeURIComponent(idea)}&mode=works`)}>查看关键词结果</Button><Button variant="primary" disabled={!hasAnyIntent(intent)} onClick={confirm}>确认并查找相似作品</Button></div></div>
        {!hasAnyIntent(intent) ? <p className="field__error" role="alert">请先选择作品品类，并至少补充一个查找条件后继续。</p> : null}
      </section> : null}
    </main>
  )
}
