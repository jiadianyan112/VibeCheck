import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, ErrorPanel, LoadingState, Tag } from '../components'
import { IntentEditor } from '../features'
import { intentService, type IntentParseResult, type ServiceError } from '../services'
import { createPrototypeEvent, useAppState } from '../state'
import type { ComparisonIntent } from '../types'

function emptyIntent(originalQuery: string): ComparisonIntent { return { originalQuery, targetUsers: [], useScenarios: [], inputs: [], practiceFormats: [], outputs: [] } }
function hasAnyIntent(intent: ComparisonIntent) { return intent.targetUsers.length + intent.useScenarios.length + intent.inputs.length + intent.practiceFormats.length + intent.outputs.length > 0 }
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
      if (!result.ok) setError(result.error)
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

  const confidenceText = useMemo(() => parseResult?.confidence === 'high' ? '高置信' : parseResult?.confidence === 'medium' ? '中置信' : '低置信', [parseResult])

  function beginParse() { const next = draftText.trim(); if (next) navigate(`/discover?idea=${encodeURIComponent(next)}`) }
  function confirm() {
    if (!hasAnyIntent(intent)) return
    const next = new URLSearchParams({ idea: intent.originalQuery })
    intent.targetUsers.forEach((v) => next.append('target', v)); intent.useScenarios.forEach((v) => next.append('scenario', v)); intent.inputs.forEach((v) => next.append('input', v)); intent.practiceFormats.forEach((v) => next.append('practice', v)); intent.outputs.forEach((v) => next.append('output', v))
    dispatch({ type: 'EVENT_LOGGED', event: createPrototypeEvent('intent_confirmed', { idea: intent.originalQuery }) })
    navigate(`/discover/result?${next}`)
  }

  return (
    <main className="page-container page-with-bottom-space stack">
      <header className="page-intro stack stack--small"><p className="eyebrow">Find similar</p><h1>先确认你要解决的问题</h1><p>系统只按固定规则拆解文本。请修正标签后再严格筛选，原始想法不会被改写。</p></header>
      <section className="idea-input-panel stack"><label className="field"><span className="field__label">完整产品想法</span><textarea className="input textarea" rows={4} value={draftText} onChange={(event) => setDraftText(event.target.value)} placeholder="例如：我想把大学 PDF 讲义生成选择题和简答题" /></label><div className="cluster"><Button variant="primary" disabled={!draftText.trim()} onClick={beginParse}>{idea ? '重新解析这段文本' : '解析并确认'}</Button>{idea ? <Button variant="quiet" onClick={() => { setDraftText(''); navigate('/discover') }}>清空</Button> : null}</div></section>

      {loading ? <LoadingState label="意图解析中，同时可返回关键词搜索" /> : error ? <ErrorPanel message={error.message} detail={error.code} onRetry={beginParse} /> : idea && parseResult ? <section className="stack">
        <div className={`parse-notice parse-notice--${parseResult.status}`} role="status"><div className="cluster"><Tag tone={parseResult.confidence === 'high' ? 'default' : 'dashed'}>{confidenceText}</Tag><strong>{parseResult.status === 'failed' ? '自动解析失败' : parseResult.status === 'partial' ? '只识别出部分字段' : '自动解析完成'}</strong></div><p>{parseResult.message}</p>{parseResult.matchedRules.length ? <p>命中规则：{parseResult.matchedRules.join('、')}</p> : null}</div>
        <IntentEditor value={intent} onChange={setIntent} />
        <div className="cluster cluster--between"><Button onClick={() => setIntent(originalIntent)}>恢复原始解析</Button><div className="cluster"><Button variant="quiet" onClick={() => navigate(`/search?q=${encodeURIComponent(idea)}&mode=similar`)}>先看关键词结果</Button><Button variant="primary" disabled={!hasAnyIntent(intent)} onClick={confirm}>确认并查看同类分析</Button></div></div>
        {!hasAnyIntent(intent) ? <p className="field__error" role="alert">空意图不能提交：请至少添加一个目标、场景、输入、练习形式或输出标签。</p> : null}
      </section> : <aside className="empty-state"><strong>输入一句完整想法开始</strong><p>短关键词更适合直接使用全局搜索；这里用于确认较完整的产品意图。</p></aside>}
    </main>
  )
}
