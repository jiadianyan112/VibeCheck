import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthGate, useOptionalAuthSession } from '../features/auth'
import { experienceApi, ExperienceApiError, type Experience } from '../services/experienceApi'
import { discussionApi } from '../services/discussionApi'
import { submissionAssetsApi } from '../services/submissionAssetsApi'

type Screenshot = { id: string; file: File; preview: string; mediaId: string | null; status: 'uploading' | 'scanning' | 'ready' | 'failed'; error: string | null }
type Draft = { task: string; outcome: string; scenario: string; limitation: string }
const blankDraft: Draft = { task: '', outcome: '', scenario: '', limitation: '' }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `vc-${Date.now()}-${Math.random().toString(36).slice(2)}`

function errorText(error: unknown): string {
  if (error instanceof ExperienceApiError) {
    if (error.status === 401) return '请先登录后继续。'
    if (error.status === 403) return '当前账号没有执行此操作的权限；只有已验证的作品作者可以回复。'
    if (error.status === 429) return '操作过于频繁，请稍后再试。'
    if (error.code === 'EXPERIENCE_SCREENSHOT_NOT_READY') return '截图仍在安全处理，请稍后重试。'
    return `操作未完成（${error.code}）。`
  }
  return error instanceof Error ? error.message : '操作暂时无法完成，请稍后重试。'
}

export function ExperienceSection({ projectId }: { projectId: string }) {
  const auth = useOptionalAuthSession()
  const { requireLogin } = useAuthGate()
  const session = auth?.session ?? null
  const storageKey = `vibecheck-experience-draft:${projectId}`
  const [draft, setDraft] = useState<Draft>(() => {
    try { return { ...blankDraft, ...JSON.parse(sessionStorage.getItem(storageKey) ?? '{}') as Draft } } catch { return blankDraft }
  })
  const [items, setItems] = useState<readonly Experience[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [screenshots, setScreenshots] = useState<Screenshot[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [savedReply] = useState<{ id: string | null; asAuthor: boolean; body: string }>(() => {
    try { return JSON.parse(sessionStorage.getItem(`${storageKey}:reply`) ?? 'null') ?? { id: null, asAuthor: false, body: '' } }
    catch { return { id: null, asAuthor: false, body: '' } }
  })
  const [replyId, setReplyId] = useState<string | null>(savedReply.id)
  const [replyAsAuthor, setReplyAsAuthor] = useState(savedReply.asAuthor)
  const [replyBody, setReplyBody] = useState(savedReply.body)
  const submissionReceipt = useRef<{ payload: string; requestId: string } | null>(null)

  const reload = useCallback(async (nextCursor: string | null = null) => {
    if (!uuid.test(projectId)) { setLoading(false); return }
    setLoading(true)
    try {
      const page = await experienceApi.list(projectId, nextCursor)
      setItems((previous) => nextCursor ? [...previous, ...page.items] : page.items)
      setCursor(page.next_cursor)
      setError(null)
    } catch (cause) { setError(errorText(cause)) }
    finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(draft)) } catch { /* storage unavailable */ }
  }, [draft, storageKey])
  useEffect(() => {
    try { sessionStorage.setItem(`${storageKey}:reply`, JSON.stringify({ id: replyId, asAuthor: replyAsAuthor, body: replyBody })) } catch { /* storage unavailable */ }
  }, [replyId, replyAsAuthor, replyBody, storageKey])

  async function upload(screenshot: Screenshot) {
    if (!session) return
    setScreenshots((current) => current.map((item) => item.id === screenshot.id ? { ...item, status: 'uploading', error: null } : item))
    try {
      const result = await submissionAssetsApi.uploadExperienceScreenshot({ file: screenshot.file, session,
        prepareIdempotencyKey: `experience-prepare-${screenshot.id}`, completeIdempotencyKey: `experience-complete-${screenshot.id}` })
      setScreenshots((current) => current.map((item) => item.id === screenshot.id ? { ...item, mediaId: result.media.media_resource_id, status: result.status === 'ready' ? 'ready' : 'scanning' } : item))
      if (result.status === 'ready') return
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        const latest = await submissionAssetsApi.getMediaStatus({ mediaResourceId: result.media.media_resource_id, session })
        if (latest.status === 'ready') {
          setScreenshots((current) => current.map((item) => item.id === screenshot.id ? { ...item, status: 'ready' } : item))
          return
        }
        if (latest.status === 'terminal') throw new Error('图片未通过安全检查，请更换图片。')
      }
      throw new Error('图片处理时间较长，请点击重试。')
    } catch (cause) {
      setScreenshots((current) => current.map((item) => item.id === screenshot.id ? { ...item, status: 'failed', error: errorText(cause) } : item))
    }
  }

  function addFiles(files: FileList | null) {
    if (!files) return
    const added = Array.from(files).slice(0, Math.max(0, 3 - screenshots.length))
    for (const file of added) {
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type) || file.size > 5_242_880 || file.size < 1) {
        setFormError('仅支持 JPG、PNG、WebP、AVIF，每张不超过 5 MiB。')
        continue
      }
      const screenshot: Screenshot = { id: makeId(), file, preview: URL.createObjectURL(file), mediaId: null, status: 'uploading', error: null }
      setScreenshots((current) => [...current, screenshot])
      void upload(screenshot)
    }
  }

  function retryScreenshot(item: Screenshot) {
    const replacement: Screenshot = { ...item, id: makeId(), mediaId: null, status: 'uploading', error: null }
    setScreenshots((current) => current.map((entry) => entry.id === item.id ? replacement : entry))
    void upload(replacement)
  }

  async function submit() {
    if (!draft.task.trim()) { setFormError('请填写完成的任务。'); return }
    if (!draft.outcome.trim()) { setFormError('请填写实际结果。'); return }
    if (draft.task.length > 500 || draft.outcome.length > 1000 || draft.scenario.length > 500 || draft.limitation.length > 500) {
      setFormError('填写内容超过字数限制。'); return
    }
    if (!session) {
      requireLogin({ id: makeId(), kind: 'comment', sourcePath: `/project/${projectId}#experiences`, payload: { body: draft.outcome, category: 'usage_feedback', parentId: '' } })
      return
    }
    if (screenshots.some((item) => item.status !== 'ready')) { setFormError('请等待截图处理完成，或移除未就绪的图片。'); return }
    setSubmitting(true); setFormError(null)
    try {
      const payload = {
        task: draft.task.trim(), outcome: draft.outcome.trim(),
        scenario: draft.scenario.trim() || null, limitation: draft.limitation.trim() || null,
        screenshot_media_resource_ids: screenshots.map((item) => item.mediaId!).filter(Boolean),
      }
      const serialized = JSON.stringify(payload)
      if (submissionReceipt.current?.payload !== serialized) submissionReceipt.current = { payload: serialized, requestId: makeId() }
      await experienceApi.create(projectId, session, { ...payload, client_request_id: submissionReceipt.current.requestId })
      submissionReceipt.current = null
      setDraft(blankDraft)
      try { sessionStorage.removeItem(storageKey) } catch { /* storage unavailable */ }
      screenshots.forEach((item) => URL.revokeObjectURL(item.preview))
      setScreenshots([])
      await reload()
    } catch (cause) { setFormError(errorText(cause)) }
    finally { setSubmitting(false) }
  }

  async function reply(experienceId: string) {
    if (!replyBody.trim()) return
    if (!session) {
      requireLogin({ id: makeId(), kind: 'comment', sourcePath: `/project/${projectId}#experiences`, payload: { body: replyBody, category: 'usage_feedback', parentId: experienceId } })
      return
    }
    try {
      if (replyAsAuthor) await experienceApi.reply(experienceId, session, replyBody.trim())
      else await discussionApi.create(projectId, session, replyBody.trim(), experienceId)
      setReplyId(null); setReplyBody(''); await reload()
      if (!replyAsAuthor) setNotice('回复已提交审核，通过后会显示。')
    }
    catch (cause) { setError(errorText(cause)) }
  }

  async function report(experienceId: string) {
    if (!session) {
      requireLogin({ id: makeId(), kind: 'comment', sourcePath: `/project/${projectId}#experiences`, payload: { body: '', category: 'usage_feedback', parentId: '' } })
      return
    }
    try { await experienceApi.report(experienceId, session); await reload() }
    catch (cause) { setError(errorText(cause)) }
  }

  return <section id="experiences" className="experience-section stack" aria-labelledby="experience-heading">
    <div className="section-heading"><h2 id="experience-heading">实际体验</h2><p>记录你用这件作品完成的任务和结果；主观判断请写在适用场景与局限中。</p></div>
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {loading && !items.length ? <p role="status">正在读取体验记录…</p> : null}
    {items.length ? <ol className="experience-list">{items.map((item) => <li key={item.comment_id} className="experience-card stack stack--small">
      <div className="cluster cluster--between"><strong>{item.author_label}</strong><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleDateString('zh-CN')}</time></div>
      <dl className="experience-facts"><div><dt>完成任务</dt><dd>{item.task}</dd></div><div><dt>实际结果</dt><dd>{item.outcome}</dd></div></dl>
      {item.scenario || item.limitation ? <dl className="experience-opinions">{item.scenario ? <div><dt>适用场景 · 个人判断</dt><dd>{item.scenario}</dd></div> : null}{item.limitation ? <div><dt>局限 · 个人判断</dt><dd>{item.limitation}</dd></div> : null}</dl> : null}
      {item.screenshot_media_resource_ids.length ? <div className="experience-screenshots">{item.screenshot_media_resource_ids.map((mediaId, index) => <img key={mediaId} src={experienceApi.screenshotUrl(item.comment_id, mediaId)} alt={`体验截图 ${index + 1}`} loading="lazy" />)}</div> : null}
      {item.author_reply ? <aside className="experience-author-reply"><strong>已验证作者回复</strong><p>{item.author_reply}</p></aside> : null}
      {item.replies?.length ? <ol className="experience-discussion-replies">{item.replies.map((replyItem) => <li key={replyItem.comment_id}><strong>讨论回复</strong><p>{replyItem.body}</p><button className="button button--quiet" type="button" onClick={() => void report(replyItem.comment_id)}>举报回复</button></li>)}</ol> : null}
      <div className="cluster"><button className="button button--quiet" type="button" onClick={() => { setReplyId(item.comment_id); setReplyBody(''); setReplyAsAuthor(false) }}>讨论回复</button>{session ? <button className="button button--quiet" type="button" onClick={() => { setReplyId(item.comment_id); setReplyBody(''); setReplyAsAuthor(true) }}>作者回复</button> : null}<button className="button button--quiet" type="button" onClick={() => void report(item.comment_id)}>举报</button></div>
      {replyId === item.comment_id ? <div className="stack stack--small"><label className="field"><span className="field__label">回复内容</span><textarea className="input textarea" value={replyBody} onChange={(event) => setReplyBody(event.target.value)} maxLength={2000} rows={3} /></label><div className="cluster"><button className="button button--primary" type="button" onClick={() => void reply(item.comment_id)} disabled={!replyBody.trim()}>发送回复</button><button className="button" type="button" onClick={() => setReplyId(null)}>取消</button></div></div> : null}
    </li>)}</ol> : !loading ? <p>还没有实际体验记录。欢迎分享一次具体的使用过程。</p> : null}
    {cursor ? <button className="button" type="button" onClick={() => void reload(cursor)} disabled={loading}>加载更多体验</button> : null}
    <div className="experience-composer stack"><h3>写下你的实际体验</h3>
      <label className="field"><span className="field__label">完成的任务 *</span><textarea className="input textarea" value={draft.task} onChange={(event) => setDraft({ ...draft, task: event.target.value })} maxLength={500} rows={2} placeholder="你想用这件作品做什么？" /></label>
      <label className="field"><span className="field__label">实际结果 *</span><textarea className="input textarea" value={draft.outcome} onChange={(event) => setDraft({ ...draft, outcome: event.target.value })} maxLength={1000} rows={3} placeholder="实际完成了什么？遇到了什么问题？" /></label>
      <label className="field"><span className="field__label">适用场景（选填，个人判断）</span><textarea className="input textarea" value={draft.scenario} onChange={(event) => setDraft({ ...draft, scenario: event.target.value })} maxLength={500} rows={2} /></label>
      <label className="field"><span className="field__label">局限（选填，个人判断）</span><textarea className="input textarea" value={draft.limitation} onChange={(event) => setDraft({ ...draft, limitation: event.target.value })} maxLength={500} rows={2} /></label>
      <label className="field"><span className="field__label">截图（选填，最多 3 张，每张不超过 5 MiB）</span><input type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple disabled={!session || screenshots.length >= 3} onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} />{!session ? <small>登录后可添加截图。</small> : null}</label>
      {screenshots.length ? <ul className="experience-upload-list">{screenshots.map((item) => <li key={item.id}><img src={item.preview} alt="待提交截图预览" /><span>{item.status === 'uploading' ? '上传中' : item.status === 'scanning' ? '安全处理中' : item.status === 'ready' ? '已就绪' : item.error ?? '上传失败'}</span>{item.status === 'failed' ? <button className="button" type="button" onClick={() => retryScreenshot(item)}>重试</button> : null}<button className="button" type="button" onClick={() => { URL.revokeObjectURL(item.preview); setScreenshots((current) => current.filter((entry) => entry.id !== item.id)) }}>移除</button></li>)}</ul> : null}
      {formError ? <p className="field-error" role="alert">{formError}</p> : null}
      <button className="button button--primary" type="button" disabled={submitting || screenshots.some((item) => item.status === 'uploading' || item.status === 'scanning')} onClick={() => void submit()}>{submitting ? '提交中…' : '发布实际体验'}</button>
    </div>
  </section>
}
