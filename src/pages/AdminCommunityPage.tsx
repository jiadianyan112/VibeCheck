import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, EmptyState, LoadingState } from '../components'
import { useAuthSession } from '../features'
import { communityReviewApi, type CommunityWorkItem } from '../services/communityReviewApi'

export function AdminCommunityPage() {
  const { session } = useAuthSession()
  const [items, setItems] = useState<readonly CommunityWorkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const claimStorageKey = `vibecheck-community-claims:${session?.user_id ?? 'guest'}`
  const [claims, setClaims] = useState<Record<string, string>>(() => {
    try { return JSON.parse(sessionStorage.getItem(claimStorageKey) ?? '{}') as Record<string, string> } catch { return {} }
  })
  useEffect(() => { try { sessionStorage.setItem(claimStorageKey, JSON.stringify(claims)) } catch { /* storage unavailable */ } }, [claimStorageKey, claims])
  useEffect(() => {
    if (!session) return
    const timer = window.setInterval(() => {
      for (const [id, token] of Object.entries(claims)) {
        void communityReviewApi.heartbeat(id, token, session).catch(() => {
          setClaims((current) => { const next = { ...current }; delete next[id]; return next })
          setError('审核领取已失效，请刷新队列后重新领取。')
        })
      }
    }, 20_000)
    return () => window.clearInterval(timer)
  }, [claims, session])

  async function claim(item: CommunityWorkItem) {
    if (!session || busyId) return
    setBusyId(item.work_item_id)
    try { const token = await communityReviewApi.claim(item, session); setClaims((current) => ({ ...current, [item.work_item_id]: token })); setError(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '领取失败。') }
    finally { setBusyId(null) }
  }

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const queue = await communityReviewApi.list(session?.user_id)
      setItems(queue)
      setClaims((current) => Object.fromEntries(Object.entries(current).filter(([id]) => queue.some((item) => item.work_item_id === id && item.work_item_status === 'claimed' && item.assignee_user_id === session?.user_id && Date.parse(item.lease_expires_at ?? '') > Date.now()))))
      setError(null)
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : '队列读取失败。') }
    finally { setLoading(false) }
  }, [session?.user_id])
  useEffect(() => { void reload() }, [reload])

  async function decide(item: CommunityWorkItem, state: 'visible' | 'hidden') {
    const claimToken = claims[item.work_item_id]
    if (!session || busyId || !claimToken) return
    const reason = reasons[item.work_item_id]?.trim()
    if (!reason) { setError('请选择处理原因。'); return }
    setBusyId(item.work_item_id); setError(null)
    try { await communityReviewApi.heartbeat(item.work_item_id, claimToken, session); await communityReviewApi.decide(item, session, state, reason, claimToken); await reload() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '审核未完成。') }
    finally { setBusyId(null) }
  }

  return <div className="admin-page stack">
    <header className="admin-page-header"><div><h1>社区内容审核</h1><p>领取后核实待审核评论或举报内容，决定公开或隐藏。</p></div><span>{items.length} 项待处理</span></header>
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    <Button onClick={() => void reload()} disabled={loading || !!busyId}>刷新队列</Button>
    {loading ? <LoadingState label="正在读取社区审核队列" /> : items.length ? <section className="admin-workflow-list stack" aria-label="社区审核队列">{items.map((item) => <article key={item.work_item_id} className="admin-workflow-card stack">
      <div className="cluster cluster--between"><strong>{item.domain_summary.entry_type === 'experience' ? '实际体验' : '普通讨论'}</strong><span>{item.domain_summary.status}</span></div>
      {item.domain_summary.project_id ? <Link to={`/project/${item.domain_summary.project_id}`}>查看所属作品</Link> : null}
      {item.domain_summary.experience_task ? <p>任务：{item.domain_summary.experience_task}</p> : null}
      <p>内容：{item.domain_summary.body ?? '内容不可用'}</p>
      {item.domain_summary.experience_scenario ? <p>适用场景：{item.domain_summary.experience_scenario}</p> : null}
      {item.domain_summary.experience_limitation ? <p>局限：{item.domain_summary.experience_limitation}</p> : null}
      {claims[item.work_item_id] ? <div className="experience-screenshots">{item.domain_summary.screenshot_media_resource_ids?.map((mediaId, index) => <img key={mediaId} src={communityReviewApi.screenshotUrl(item.target_id, mediaId)} alt={`待审核截图 ${index + 1}`} />)}</div> : <Button disabled={!!busyId} onClick={() => void claim(item)}>领取并查看截图</Button>}
      <label className="field"><span className="field__label">处理原因</span><select className="input" value={reasons[item.work_item_id] ?? ''} onChange={(event) => setReasons({ ...reasons, [item.work_item_id]: event.target.value })}><option value="">请选择原因</option><option value="report_reviewed">核实后符合社区规则</option><option value="unsafe_content">不安全或违规内容</option><option value="spam">广告或垃圾内容</option><option value="harassment">骚扰或攻击性内容</option><option value="misleading">误导性内容</option></select></label>
      <div className="cluster"><Button disabled={!!busyId || !claims[item.work_item_id]} onClick={() => void decide(item, 'visible')}>公开内容</Button><Button variant="danger" disabled={!!busyId || !claims[item.work_item_id]} onClick={() => void decide(item, 'hidden')}>隐藏内容</Button></div>
    </article>)}</section> : <EmptyState title="当前没有待处理举报" />}
  </div>
}
