import { useDialogFocus } from '../components/ui/useDialogFocus'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useOptionalAuthSession } from '../features/auth/AuthSessionContext'
import { cropPublishImage, emptyPublishFields, publishFieldsFromRemote, publishSnapshot, readPublishDraft, savePublishDraft, type PublishFields, type PublishImage } from '../features/submission/publishDraft'
import { makeSubmissionClientRequestId, normalizeSubmissionUrl, remoteDraftToLocalDraft, submissionApi, SubmissionApiError, type RemoteSubmissionDraft, type UrlCheckResult } from '../services/submissionApi'
import { submissionAssetsApi } from '../services/submissionAssetsApi'
import { useAppState } from '../state'
import { userId } from '../types'

function ImagePreview({ file, alt }: { file: File; alt: string }) {
  const [url, setUrl] = useState('')
  useEffect(() => { const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next) }, [file])
  return url ? <img src={url} alt={alt} /> : null
}

function errorMessage(error: unknown) {
  if (error instanceof SubmissionApiError && error.fieldErrors.length) return `${error.message} ${error.fieldErrors.map(value => typeof value === 'string' ? value : 'message' in value ? value.message : '').filter(Boolean).join(' ')}`
  return error instanceof Error ? error.message : '操作未完成，当前内容已保留。'
}

export function PublishPage() {
  const { dispatch } = useAppState()
  const auth = useOptionalAuthSession()
  const session = auth?.session ?? null
  const ownerId = session?.user_id
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const initialDraftId = useRef(params.get('draft'))
  const storageKey = ownerId ? `user:${ownerId}` : 'guest'
  const [fields, setFields] = useState<PublishFields>(emptyPublishFields)
  const [images, setImages] = useState<PublishImage[]>([])
  const [ready, setReady] = useState(false)
  const [check, setCheck] = useState<UrlCheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkMessage, setCheckMessage] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<Partial<Record<keyof PublishFields, string>>>({})
  const [busy, setBusy] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [receipt, setReceipt] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [crop, setCrop] = useState<string | null>(null)
  const [ratio, setRatio] = useState(1)
  const remote = useRef<RemoteSubmissionDraft | null>(null)
  const preserveRemoteCovers = useRef(false)
  const [remoteCoverCount, setRemoteCoverCount] = useState(0)
  const current = useRef({ fields, images })
  current.current = { fields, images }
  const saving = useRef(false)
  const submissionKey = useRef(makeSubmissionClientRequestId())
  const ownerRef = useRef(storageKey)
  ownerRef.current = storageKey
  const operation = useRef<Promise<unknown>>(Promise.resolve())
  const pendingSubmit = useRef<Parameters<typeof submissionApi.submit>[0] | null>(null)
  const cropDialog = useRef<HTMLDivElement>(null)
  const previewDialog = useRef<HTMLElement>(null)

  useDialogFocus(Boolean(crop), cropDialog, () => setCrop(null))
  useDialogFocus(previewOpen, previewDialog, () => setPreviewOpen(false))

  useEffect(() => {
    if (auth?.status === 'loading') { setReady(false); return }
    let alive = true
    setReady(false); setFields({ ...emptyPublishFields }); setImages([]); setReceipt(null); setError(''); setStatus(''); setBusy(false); setSubmitting(false)
    remote.current = null; preserveRemoteCovers.current = false; setRemoteCoverCount(0); pendingSubmit.current = null; submissionKey.current = makeSubmissionClientRequestId()
    void (async () => {
      try {
        let saved = await readPublishDraft(storageKey)
        if ((!saved || params.get('resume') === 'guest') && ownerId) {
          const guest = await readPublishDraft('guest')
          if (guest && !guest.ownerId) {
            saved = { ...guest, ownerId, remoteId: undefined }
            await savePublishDraft(storageKey, saved)
            await savePublishDraft('guest', { fields: { ...emptyPublishFields }, images: [], ownerId })
          }
        }
        if (!saved) {
          const category = params.get('category')
          const next = { ...emptyPublishFields, url: params.get('resumeUrl') ?? '' }
          if (category === 'ai_learning_quiz' || category === 'personal_site_portfolio') next.category = category
          if (alive) setFields(next)
        }
        if (!alive) return
        if (saved && (!saved.ownerId || saved.ownerId === ownerId)) {
          setFields(saved.fields); setImages(saved.images); submissionKey.current = saved.submissionKey ?? makeSubmissionClientRequestId()
          setReceipt(saved.submittedId ?? null)
          if (saved.pendingSubmission && session) pendingSubmit.current = { ...saved.pendingSubmission, session }
        }
        const id = initialDraftId.current ?? (saved?.ownerId === ownerId ? saved?.remoteId : undefined)
        if (id && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id) && session) {
          const draft = await submissionApi.get({ draftId: id, session })
          if (!alive) return
          remote.current = draft
          preserveRemoteCovers.current = saved?.remoteId !== id || !saved?.images.length
          setRemoteCoverCount(preserveRemoteCovers.current ? draft.media_reference_ids.length : 0)
          if (saved?.remoteId !== id) {
            setFields(publishFieldsFromRemote(draft)); setImages([]); setReceipt(null)
            pendingSubmit.current = null; submissionKey.current = makeSubmissionClientRequestId()
          }
          if (draft.status === 'submitted') setReceipt('已提交')
          setStatus('草稿已恢复')
        }
      } catch (cause) { if (alive) setError(`恢复草稿失败：${errorMessage(cause)}`) }
      finally { if (alive) setReady(true) }
    })()
    return () => { alive = false }
    // Restore on identity changes, not token refreshes or internal draft URL writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, auth?.status === 'loading'])

  function pendingRequest() {
    const request = pendingSubmit.current
    return request ? { draftId: request.draftId, draftVersion: request.draftVersion, checkId: request.checkId, previewHash: request.previewHash, submissionKey: request.submissionKey } : undefined
  }

  function assertOwner() { if (ownerRef.current !== storageKey) throw new Error('账户已切换，操作已停止。') }

  async function persistLocal(nextImages = current.current.images, submittedId?: string) {
    assertOwner()
    await savePublishDraft(storageKey, { ...current.current, images: nextImages, remoteId: remote.current?.draft_id, ownerId, submissionKey: submissionKey.current, submittedId, pendingSubmission: pendingRequest() })
  }

  useEffect(() => {
    if (!ready || receipt) return
    const timer = window.setTimeout(() => {
      void savePublishDraft(storageKey, { fields, images, remoteId: remote.current?.draft_id, ownerId, submissionKey: submissionKey.current, pendingSubmission: pendingRequest() })
        .then(() => setStatus(session ? '草稿已保存到此设备' : '草稿已保存到此设备，登录后可同步'))
        .catch(() => setStatus('保存失败，请保留此页面并重试'))
    }, 450)
    return () => window.clearTimeout(timer)
  }, [fields, images, ready, receipt, storageKey, ownerId, session])

  useEffect(() => {
    setCheck(null); setCheckMessage('')
    if (!ready || !fields.url.trim() || !fields.category || receipt) return
    try { normalizeSubmissionUrl(fields.url.trim()) } catch { return }
    if (!session) { setCheckMessage('登录后检查链接，不影响继续填写。'); return }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setChecking(true)
      void submissionApi.check({ rawUrl: fields.url.trim(), categoryId: fields.category as Exclude<PublishFields['category'], ''>, session, signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) setCheck(result) })
        .catch(cause => { if (!controller.signal.aborted) setCheckMessage(errorMessage(cause)) })
        .finally(() => { if (!controller.signal.aborted) setChecking(false) })
    }, 650)
    return () => { window.clearTimeout(timer); controller.abort(); setChecking(false) }
  }, [fields.url, fields.category, ready, receipt, session])

  function change<K extends keyof PublishFields>(key: K, value: PublishFields[K]) {
    if (pendingSubmit.current) { pendingSubmit.current = null; submissionKey.current = makeSubmissionClientRequestId() }
    setFields(previous => ({ ...previous, [key]: value }))
    setErrors(previous => ({ ...previous, [key]: undefined }))
    setError('')
  }

  async function getCheck(data = current.current.fields, force = false): Promise<UrlCheckResult> {
    if (!data.category) throw new Error('请选择作品分类。')
    const normalized = normalizeSubmissionUrl(data.url.trim())
    const result = !force && check?.normalizedUrl === normalized && check.categoryId === data.category && (!check.expiresAt || Date.parse(check.expiresAt) > Date.now() + 30_000)
      ? check : await submissionApi.check({ rawUrl: normalized, categoryId: data.category, session })
    assertOwner()
    setCheck(result)
    if (!result.canCreateDraft || result.checks.some(item => item.key === 'safety' && item.status !== 'passed')) {
      throw new Error(result.duplicateResult === 'exact' ? '已有相同作品，请查看或认领已有档案。' : result.checks.find(item => item.key === 'safety' && item.status !== 'passed')?.message || '暂时无法验证这个链接，请重试检查；当前内容已保留。')
    }
    if (!result.checkId) throw new Error('检查结果缺少编号，请重试。')
    return result
  }

  async function syncDraft(uploadImages: boolean): Promise<RemoteSubmissionDraft> {
    assertOwner()
    const data = current.current.fields
    const result = await getCheck(data)
    if (!data.category) throw new Error('请选择作品分类。')
    let draft = remote.current
    const sameIdentity = draft && draft.category_id === data.category && draft.fields.publicUrl === result.normalizedUrl
    if (!sameIdentity) {
      draft = await submissionApi.create({ checkId: result.checkId!, categoryId: data.category, session })
      assertOwner()
      remote.current = draft
      preserveRemoteCovers.current = false; setRemoteCoverCount(0)
      setParams({ draft: draft.draft_id }, { replace: true })
    }
    if (!draft) throw new Error('无法创建草稿，请重试。')
    const nextImages = [...current.current.images]
    if (uploadImages && nextImages.length) {
      for (let index = 0; index < nextImages.length; index++) {
        let item = nextImages[index]!
        try {
          if (!item.resourceId) {
            const upload = await submissionAssetsApi.uploadCover({ draftId: draft.draft_id, file: item.file, prepareIdempotencyKey: `prepare-${item.id}`, completeIdempotencyKey: `complete-${item.id}`, session })
            assertOwner()
            item = { ...item, resourceId: upload.media.media_resource_id }
            assertOwner()
          nextImages[index] = item; current.current.images = nextImages; setImages([...nextImages]); await persistLocal(nextImages)
            if (upload.status === 'terminal') throw new Error('图片未通过安全检查，请移除或更换。')
          }
          if (!item.referenceId || item.referenceDraftId !== draft.draft_id || item.referenceOrder !== index) {
            const reference = await submissionAssetsApi.createCoverReference({ draftId: draft.draft_id, mediaResourceId: item.resourceId!, altText: `${data.name || '作品'}截图 ${index + 1}`, sortOrder: index, referenceClientRequestId: `reference-${item.id}-${draft.draft_id}-${index}`, session })
            item = { ...item, referenceId: reference.media_reference_id, referenceDraftId: draft.draft_id, referenceOrder: index, error: undefined }
          } else item = { ...item, error: undefined }
          assertOwner()
          nextImages[index] = item; current.current.images = nextImages; setImages([...nextImages]); await persistLocal(nextImages)
        } catch (cause) {
          assertOwner()
          nextImages[index] = { ...item, error: errorMessage(cause) }; current.current.images = nextImages; setImages([...nextImages]); await persistLocal(nextImages)
          throw new Error(`第 ${index + 1} 张图片未就绪，可单独重试或移除。`)
        }
      }
    }
    const activeDraftId = draft.draft_id
    const referenceIds = nextImages.flatMap(item => item.referenceDraftId === activeDraftId && item.referenceId ? [item.referenceId] : [])
    // Existing remote-only covers are kept until the author explicitly replaces them.
    const keepRemote = nextImages.length === 0 && preserveRemoteCovers.current && draft.media_reference_ids.length > 0
    const references = keepRemote ? draft.media_reference_ids : referenceIds
    if (draft.media_reference_ids.some(id => !references.includes(id))) await submissionAssetsApi.removeCoverReferences({ draftId: draft.draft_id, keepIds: references, session })
    draft = await submissionApi.get({ draftId: draft.draft_id, session })
    draft = await submissionApi.patch({ draftId: draft.draft_id, expectedVersion: draft.version, snapshot: publishSnapshot(data, result.normalizedUrl, references, draft.payload_snapshot), session })
    assertOwner()
    remote.current = draft
    if (ownerId) dispatch({ type: 'DRAFT_UPSERT', draft: remoteDraftToLocalDraft(draft, userId(ownerId)) })
    await persistLocal(nextImages)
    return draft
  }

  async function enqueue(action: () => Promise<void>) {
    const queued = operation.current.catch(() => undefined).then(action)
    operation.current = queued
    await queued
  }

  async function save() {
    setBusy(true); setError('')
    await enqueue(async () => {
    saving.current = true
    try { assertOwner() } catch { setBusy(false); return }
    try {
      await persistLocal()
      if (session && fields.category && fields.url && !pendingSubmit.current) { await syncDraft(true); setStatus('草稿已同步') }
      else setStatus('草稿已保存到此设备')
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false); saving.current = false }
    })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const invalid: Partial<Record<keyof PublishFields, string>> = {}
    if (!fields.name.trim()) invalid.name = '请填写作品名称'
    if (!fields.summary.trim()) invalid.summary = '请填写一句话介绍'
    if (!fields.category) invalid.category = '请选择作品分类'
    try { normalizeSubmissionUrl(fields.url.trim()); if (!fields.url.trim()) throw new Error() } catch { invalid.url = '请输入有效的公开链接，例如 example.com' }
    if (fields.repository.trim()) { try { normalizeSubmissionUrl(fields.repository.trim()) } catch { invalid.repository = '请输入有效的代码仓库链接' } }
    setErrors(invalid)
    const first = Object.keys(invalid)[0]
    if (first) { document.getElementById(`publish-${first}`)?.focus(); return }
    setBusy(true); setSubmitting(true); setError('')
    await enqueue(async () => {
    setBusy(true); saving.current = true
    try { assertOwner() } catch { setBusy(false); setSubmitting(false); return }
    try {
      await persistLocal()
      if (!session) { navigate(`/auth?return_to=${encodeURIComponent('/submit?resume=guest')}`); return }
      if (!pendingSubmit.current) {
      let draft = await syncDraft(true)
      const result = await getCheck()
      const preview = await submissionApi.preview({ draftId: draft.draft_id, expectedVersion: draft.version, checkId: result.checkId!, session })
      draft = await submissionApi.get({ draftId: draft.draft_id, session })
      remote.current = draft
      pendingSubmit.current = { draftId: draft.draft_id, draftVersion: draft.version, checkId: result.checkId!, previewHash: preview.previewHash, submissionKey: submissionKey.current, session }
      }
      await persistLocal()
      const submitted = await submissionApi.submit({ ...pendingSubmit.current, session })
      assertOwner()
      if (remote.current && ownerId) {
        const local = remoteDraftToLocalDraft(remote.current, userId(ownerId))
        dispatch({ type: 'DRAFT_UPSERT', draft: { ...local, status: 'pending_review', submissionId: submitted.submissionId, reviewWorkItemId: submitted.reviewWorkItemId, submittedAt: new Date().toISOString(), submittedFields: { ...local.fields }, submittedAssetIds: [...local.assetIds] } })
      }
      pendingSubmit.current = null
      setReceipt(submitted.submissionId)
      await persistLocal(current.current.images, submitted.submissionId)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false); setSubmitting(false); saving.current = false }
    })
  }

  function invalidateSubmission() {
    if (pendingSubmit.current) { pendingSubmit.current = null; submissionKey.current = makeSubmissionClientRequestId() }
  }

  function addImages(files: FileList | null) {
    if (!files) return
    const incoming = Array.from(files)
    if (images.length + incoming.length > 9) { setError('最多添加 9 张图片。'); return }
    if (incoming.some(file => !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type) || file.size > 5_242_880)) { setError('请选择 JPG、PNG、WebP 或 AVIF 图片，每张不超过 5 MB。'); return }
    invalidateSubmission(); preserveRemoteCovers.current = false; setRemoteCoverCount(0)
    setImages(previous => [...previous, ...incoming.map(file => ({ id: makeSubmissionClientRequestId(), file }))]); setError('')
  }

  async function applyCrop() {
    const item = images.find(image => image.id === crop)
    if (!item) return
    try {
      const file = await cropPublishImage(item.file, ratio)
      invalidateSubmission()
      setImages(previous => previous.map(image => image.id === item.id ? { id: makeSubmissionClientRequestId(), file } : image)); setCrop(null)
    } catch (cause) { setError(errorMessage(cause)) }
  }

  async function startAnother() {
    try {
      const freshKey = makeSubmissionClientRequestId()
      await savePublishDraft(storageKey, { fields: { ...emptyPublishFields }, images: [], ownerId, submissionKey: freshKey })
      remote.current = null; pendingSubmit.current = null; preserveRemoteCovers.current = false
      initialDraftId.current = null; submissionKey.current = freshKey
      setParams({}, { replace: true }); setFields({ ...emptyPublishFields }); setImages([]); setReceipt(null)
      setRemoteCoverCount(0); setErrors({}); setError(''); setStatus(''); setCheck(null)
    } catch (cause) { setError(errorMessage(cause)) }
  }

  if (receipt) return <main className="highfi-scope publish-page"><section className="publish-success"><span aria-hidden="true">✓</span><h1>已提交审核</h1><p>审核结果会通过通知告知你。</p>{error && <p role="alert">{error}</p>}<button type="button" className="button button--secondary" onClick={() => void startAnother()}>再发布一个</button><Link className="button button--primary" to="/me">查看我的作品</Link><Link className="button button--secondary" to="/projects">逛逛作品广场</Link></section></main>

  const blocked = check?.checks.find(item => item.key === 'safety' && item.status !== 'passed')
  const uncertain = check?.checks.find(item => item.key === 'access' && item.status !== 'passed')
  const card = <div className="publish-preview-card"><div className="publish-preview-image">{images[0] ? <ImagePreview file={images[0].file} alt="作品封面预览" /> : <div className="publish-preview-placeholder"><span>VibeCheck</span><small>{remoteCoverCount ? '已保存封面，提交时保留' : '暂无封面'}</small></div>}</div><h3>{fields.name || '作品名称'}</h3><p>{fields.summary || '用一句话介绍你的作品'}</p><small>{fields.category === 'ai_learning_quiz' ? 'AI 学习与题库' : fields.category === 'personal_site_portfolio' ? '个人网站与作品集' : '作品分类'}</small></div>
  const field = (key: 'name' | 'url' | 'summary' | 'repository', label: string, placeholder: string, maxLength = 200) => <label className="publish-field" htmlFor={`publish-${key}`}><span>{label}</span><input id={`publish-${key}`} value={fields[key]} onChange={event => change(key, event.target.value)} placeholder={placeholder} maxLength={maxLength} aria-required={key !== 'repository'} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `publish-${key}-error` : undefined} />{errors[key] && <small className="publish-error" id={`publish-${key}-error`}>{errors[key]}</small>}</label>

  return <main className="highfi-scope publish-page">
    <form onSubmit={event => void submit(event)} noValidate>
      <header className="publish-header"><div><h1>发布作品</h1><p>分享你的创造，让好作品被看见。</p></div><div className="publish-actions"><button type="button" className="button button--secondary" onClick={() => void save()} disabled={busy || !ready}>存草稿</button><button className="button button--primary" type="submit" disabled={submitting || !ready}>{submitting ? '处理中…' : '提交审核'}</button></div></header>
      {error && <div className="publish-error" role="alert">{error}</div>}
      {!ready && <p role="status">正在恢复草稿…</p>}
      <div className="publish-layout"><fieldset className="publish-editor" disabled={busy || !ready}>
        <section className="publish-section" aria-label="作品内容">
          <div className="publish-media-grid">{images.map((item, index) => <div className="publish-media-item" key={item.id}><ImagePreview file={item.file} alt={`作品截图 ${index + 1}`} /><span>{index === 0 ? '封面' : index + 1}</span><div className="publish-media-actions"><button type="button" onClick={() => { setCrop(item.id); setRatio(1) }}>裁剪</button><button type="button" disabled={index === 0} aria-label={`将第 ${index + 1} 张图片前移`} onClick={() => { invalidateSubmission(); setImages(previous => { const next = [...previous]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return next }) }}>前移</button><button type="button" aria-label={`移除第 ${index + 1} 张图片`} onClick={() => { invalidateSubmission(); setImages(previous => previous.filter(image => image.id !== item.id)) }}>移除</button></div>{item.error && <div className="publish-error"><small>{item.error}</small><button type="button" onClick={() => void save()}>重试这张图片</button></div>}</div>)}{images.length < 9 && <label className="publish-upload"><span aria-hidden="true">＋</span><strong>添加作品截图</strong><small>{images.length ? `${images.length}/9` : '第一张作为封面'}</small><input type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple aria-label="添加作品截图" onChange={event => { addImages(event.target.files); event.target.value = '' }} /></label>}</div>
          {remoteCoverCount > 0 && <p className="publish-hint">已保留 {remoteCoverCount} 张云端截图，添加图片可替换。</p>}
          <p className="publish-hint">截图选填 · 最多 9 张 · 每张不超过 5 MB</p>
          {field('name', '作品名称 *', '给作品起个名字', 80)}
          {field('summary', '一句话介绍 *', '它能做什么，有什么特别之处？', 200)}
          {field('url', '作品链接 *', 'https:// 或直接粘贴域名', 2048)}
          <div className="publish-link-status" role="status">{checking ? '正在检查链接，不影响继续填写…' : blocked ? blocked.message : check?.duplicateProjectId ? '发现已有或相似作品，请先确认。' : uncertain ? '暂时无法验证链接，可继续填写，提交后核验。' : check ? '链接检查已完成。' : checkMessage || '粘贴链接后自动检查。'}{fields.url && session && <button type="button" onClick={() => { setCheck(null); setChecking(true); void getCheck(current.current.fields, true).catch(cause => setCheckMessage(errorMessage(cause))).finally(() => setChecking(false)) }}>重新检查</button>}</div>
          {check?.duplicateProjectId && <div className="publish-duplicate"><strong>{check.duplicateCandidate?.currentName || '已有作品'}</strong><Link to={`/project/${check.duplicateProjectId}`} target="_blank" rel="noreferrer">查看作品</Link>{check.duplicateResult === 'exact' ? <p>同一作品请在详情页认领或更新，当前输入已保留。</p> : <p>如果是不同作品，可继续填写并提交审核。</p>}</div>}
          <label className="publish-field" htmlFor="publish-category"><span>作品分类 *</span><select id="publish-category" value={fields.category} onChange={event => change('category', event.target.value as PublishFields['category'])} aria-required="true" aria-invalid={Boolean(errors.category)} aria-describedby={errors.category ? 'publish-category-error' : undefined}><option value="">选择一个最合适的分类</option><option value="ai_learning_quiz">AI 学习与题库</option><option value="personal_site_portfolio">个人网站与作品集</option></select>{errors.category && <small id="publish-category-error" className="publish-error">{errors.category}</small>}</label>
        </section>
        {fields.category === 'ai_learning_quiz' && <details className="publish-details"><summary>更多介绍 <small>选填</small></summary><label className="publish-field" htmlFor="publish-description"><span>解决了什么问题</span><textarea id="publish-description" value={fields.description} onChange={event => change('description', event.target.value)} placeholder="介绍使用场景和解决的问题" maxLength={3000} /></label></details>}
        <details className="publish-details"><summary>开发工具与技术 <small>选填</small></summary><label className="publish-field" htmlFor="publish-technologies"><span>技术栈</span><input id="publish-technologies" value={fields.technologies} onChange={event => change('technologies', event.target.value)} placeholder="例如 React、Python，用逗号分隔" maxLength={500} /></label></details>
        <details className="publish-details" open={Boolean(errors.repository)}><summary>源码与可复用资源 <small>选填</small></summary>{field('repository', '代码仓库', '公开仓库链接', 2048)}</details>
      </fieldset><aside tabIndex={previewOpen ? -1 : undefined} ref={previewDialog} role={previewOpen ? 'dialog' : undefined} aria-modal={previewOpen || undefined} className={`publish-preview${previewOpen ? ' publish-preview--open' : ''}`} aria-label="广场展示预览"><div className="publish-preview-heading"><h2>广场展示预览</h2><button type="button" onClick={() => setPreviewOpen(false)}>关闭预览</button></div>{card}<p>审核通过后，你的作品会出现在这里。</p></aside></div>
      <footer className="publish-footer"><span className="publish-status" role="status">{status || '详细信息可在提交后继续完善'}</span><button type="button" className="button button--secondary publish-mobile-preview" onClick={() => setPreviewOpen(true)}>预览</button><button type="submit" className="button button--primary" disabled={submitting || !ready}>{submitting ? '处理中…' : '提交审核'}</button></footer>
    </form>
    {crop && <div tabIndex={-1} ref={cropDialog} className="publish-crop" role="dialog" aria-modal="true" aria-labelledby="publish-crop-title"><div><h2 id="publish-crop-title">裁剪图片</h2><p>以图片中心裁剪，应用后可移除并重新上传原图。</p><label>画面比例<select value={ratio} onChange={event => setRatio(Number(event.target.value))}><option value={1}>正方形 1:1</option><option value={4 / 3}>横图 4:3</option><option value={3 / 4}>竖图 3:4</option></select></label><div className="publish-crop-preview" style={{ aspectRatio: ratio }}>{images.find(item => item.id === crop) && <ImagePreview file={images.find(item => item.id === crop)!.file} alt="居中裁剪预览" />}</div><button type="button" className="button button--secondary" onClick={() => setCrop(null)}>取消</button><button type="button" className="button button--primary" onClick={() => void applyCrop()}>应用裁剪</button></div></div>}
  </main>
}
