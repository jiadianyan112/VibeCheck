import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { Button, ErrorPanel, LoadingState, PageFrame, Tag, useToast } from '../components'
import { useAuthSession } from '../features'
import { projectService, type ServiceError } from '../services'
import { DeveloperApiError, developerApi } from '../services/developerApi'
import { verificationApi, VerificationApiError, type CreatorAccountLink, type DeveloperKind, type NewDeveloperProfileInput, type VerificationMaterialSummary, type VerificationRequestProjection } from '../services/verificationApi'
import type { Project } from '../types'
import '../features/authorVerification/authorVerification.css'

const statusLabels: Record<VerificationRequestProjection['status'], string> = {
  draft: '待提交', pending: '待人工审核', changes_requested: '需要补充材料', verified: '身份已确认', failed: '审核未通过', withdrawn: '申请已撤回',
}

const statusMessages: Partial<Record<VerificationRequestProjection['status'], string>> = {
  pending: '材料已经提交到身份审核队列；审核过程中不会公开展示证明材料。',
  verified: '当前账号已获得这个作品的管理权限。',
  failed: '本次材料没有通过审核，你可以保留原申请记录并重新发起申请。',
  withdrawn: '这次申请已撤回，作品公开页面和历史记录保持不变。',
}

function errorMessage(error: unknown): string {
  if (error instanceof VerificationApiError) {
    const messages: Record<string, string> = {
      NETWORK_UNAVAILABLE: '网络连接失败，已保留当前输入，请稍后重试。',
      VERIFICATION_VERSION_CONFLICT: '申请已在其他设备更新，请刷新申请状态后重试。',
      VERIFICATION_REQUEST_NOT_EDITABLE: '申请状态已经改变，请刷新申请状态。',
      VERIFICATION_MATERIAL_NOT_READY: '材料仍在扫描中，请稍后检查材料状态。',
      MATERIAL_UPLOAD_FAILED: '材料上传未完成，请重新选择文件后重试。',
      ORIGIN_INVALID: '当前页面来源未被接受，请刷新后重试。',
      ACCOUNT_WRITE_RESTRICTED: '当前账号处于只读状态，暂时不能提交身份材料。',
    }
    return messages[error.code] ?? `操作未完成（${error.code}），请刷新后重试。`
  }
  if (error instanceof DeveloperApiError) {
    if (error.status === 401 || error.code === 'AUTH_REQUIRED') return '登录状态已失效，请重新登录后继续。'
    if (error.code === 'NETWORK_UNAVAILABLE') return '网络连接失败，已保留当前输入，请稍后重试。'
    return `作品管理信息暂时不可用（${error.code}），请刷新后重试。`
  }
  if (error instanceof Error) return error.message
  return '身份审核服务暂时不可用，请稍后重试。'
}

function developerFromProject(project: Project | null, fallbackName: string): Partial<NewDeveloperProfileInput> {
  const developer = project?.developer
  if (!developer) return { kind: 'individual', display_name: fallbackName }
  return {
    kind: developer.kind === 'team' ? 'team' : 'individual',
    display_name: developer.displayName || fallbackName,
    avatar_url: developer.avatarUrl ?? null,
    website_url: developer.websiteUrl ?? null,
  }
}

function readFileBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('FILE_READ_FAILED'))
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.readAsArrayBuffer(file)
  })
}

function digestFile(file: File): Promise<string> {
  return readFileBuffer(file).then(async (buffer) => {
    if (!globalThis.crypto?.subtle) throw new VerificationApiError('CHECKSUM_UNAVAILABLE', 0, true)
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer)
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
  })
}

function acceptedMaterial(materials: readonly VerificationMaterialSummary[]) {
  return materials.filter((material) => material.applicant_scan_state === 'accepted')
}

export function AuthorVerificationPage() {
  const { id } = useParams()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const { session, status: authStatus } = useAuthSession()
  const { pushToast } = useToast()
  const [project, setProject] = useState<Project | null>(null)
  const [request, setRequest] = useState<VerificationRequestProjection | null>(null)
  const [supersedesVerificationId, setSupersedesVerificationId] = useState<string | null>(null)
  const [startingOver, setStartingOver] = useState(false)
  const draftPatchPending = useRef(false)
  const [links, setLinks] = useState<CreatorAccountLink[]>([])
  const [materials, setMaterials] = useState<VerificationMaterialSummary[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState<DeveloperKind>('individual')
  const [resolution, setResolution] = useState<'create_new_creator' | 'use_existing_link'>('create_new_creator')
  const [selectedLinkId, setSelectedLinkId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [summary, setSummary] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<ServiceError | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [validation, setValidation] = useState<string | null>(null)
  const [loadNonce, setLoadNonce] = useState(0)

  const verificationId = params.get('verification_id')
  const ownerLinks = useMemo(() => links.filter((link) => link.status === 'active' && link.link_role === 'owner'), [links])
  const canEdit = !request || request.status === 'draft' || request.status === 'changes_requested'
  const canStartOver = !startingOver && (request?.status === 'failed' || request?.status === 'withdrawn')
  const accepted = acceptedMaterial(materials)
  const projectName = project?.currentName.state === 'known' ? project.currentName.value : '名称未知的作品'

  useEffect(() => {
    if (authStatus === 'loading') return
    if (!session) { setLoading(false); return }
    if (startingOver) { setLoading(false); return }
    let active = true
    setLoading(true)
    Promise.all([
      projectService.getById(id as Project['id']),
      verificationId ? Promise.resolve(null) : developerApi.listMyProjects({ projectId: String(id) }),
      verificationApi.listMyCreatorLinks(session),
    ]).then(async ([projectResult, myProjects, loadedLinks]) => {
      if (!active) return
      if (draftPatchPending.current) { setLoading(false); return }
      if (!projectResult.ok) { setLoadError(projectResult.error); setLoading(false); return }
      const recoveredVerificationId = verificationId ?? myProjects?.items.find(item => item.project_id === String(id))?.verification_id ?? null
      const loadedRequest = recoveredVerificationId
        ? await verificationApi.get(session, recoveredVerificationId).catch((error) => {
          if (error instanceof VerificationApiError && error.status === 404) return null
          throw error
        })
        : null
      setProject(projectResult.data)
      setRequest(loadedRequest)
      setStartingOver(false)
      setSupersedesVerificationId(loadedRequest?.status === 'failed' || loadedRequest?.status === 'withdrawn'
        ? loadedRequest.verification_id
        : null)
      setLinks([...loadedLinks])
      if (loadedRequest) setMaterials([...loadedRequest.material_summaries])
      if (loadedRequest && !verificationId) setParams(previous => { const next = new URLSearchParams(previous); next.set('verification_id', loadedRequest.verification_id); return next }, { replace: true })
      setLoadError(null)
      setLoading(false)
    }).catch((error) => {
      if (!active) return
      setOperationError(errorMessage(error))
      setLoading(false)
    })
    return () => { active = false }
  }, [authStatus, id, loadNonce, session, setParams, startingOver, verificationId])

  function retryLoad() {
    setLoadError(null)
    setOperationError(null)
    setLoading(true)
    setLoadNonce(value => value + 1)
  }

  useEffect(() => {
    if (!project || !session || request) return
    const developer = developerFromProject(project, session.display_name)
    setKind(developer.kind === 'team' ? 'team' : 'individual')
    setDisplayName(developer.display_name ?? session.display_name)
    setBio(developer.bio ?? '')
    setAvatarUrl(developer.avatar_url ?? '')
    setWebsiteUrl(developer.website_url ?? '')
  }, [project, request, session])

  useEffect(() => {
    if (!request) return
    if (draftPatchPending.current) return
    const profile = request.new_creator_profile_input
    setResolution(request.creator_resolution_mode === 'use_existing_link' ? 'use_existing_link' : 'create_new_creator')
    setSelectedLinkId(request.creator_account_link_id ?? '')
    if (profile) {
      setKind(profile.kind === 'team' ? 'team' : 'individual')
      setDisplayName(profile.display_name)
      setBio(profile.bio ?? '')
      setAvatarUrl(profile.avatar_url ?? '')
      setWebsiteUrl(profile.website_url ?? '')
    }
    setSummary(request.public_summary ?? '')
    setMaterials([...request.material_summaries])
  }, [request])

  function profileInput(): NewDeveloperProfileInput | null {
    if (resolution === 'use_existing_link') return null
    return {
      kind,
      display_name: displayName.trim(),
      ...(bio.trim() ? { bio: bio.trim() } : {}),
      avatar_url: avatarUrl.trim() || null,
      website_url: websiteUrl.trim() || null,
    }
  }

  function validate(): string | null {
    if (resolution === 'use_existing_link' && !selectedLinkId) return '请选择要复用的已确认开发者身份。'
    if (resolution === 'create_new_creator' && !displayName.trim()) return '请填写开发者或团队名称。'
    if (displayName.trim().length > 80) return '开发者或团队名称不能超过 80 个字符。'
    if (bio.length > 1000) return '简介不能超过 1000 个字符。'
    const validateUrl = (value: string, label: string) => {
      const normalized = value.trim()
      if (!normalized) return null
      if (normalized.length > 2048) return `${label}不能超过 2048 个字符。`
      try {
        const url = new URL(normalized)
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password) return `${label}只能使用公开的 http 或 https 地址。`
      } catch { return `请输入完整的${label}地址。` }
      return null
    }
    const avatarError = validateUrl(avatarUrl, '头像或团队 Logo')
    if (avatarError) return avatarError
    const websiteError = validateUrl(websiteUrl, '官网')
    if (websiteError) return websiteError
    if (file) {
      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return '证明材料只能是 PDF、JPG 或 PNG 文件。'
      if (file.size < 1 || file.size > 10_485_760) return '证明材料大小必须在 1B 到 10MB 之间。'
    }
    if (summary.trim().length < 10) return '请说明材料如何证明你与这个作品的关系（至少 10 个字符）。'
    if (!accepted.length && !file) return '请上传一份 PDF、JPG 或 PNG 证明材料。'
    return null
  }

  async function refreshRequest() {
    if (!session || !request || refreshing) return
    setRefreshing(true)
    try {
      const next = await verificationApi.get(session, request.verification_id)
      setRequest(next)
      setSupersedesVerificationId(next.status === 'failed' || next.status === 'withdrawn' ? next.verification_id : null)
      setOperationError(null)
    } catch (error) { setOperationError(errorMessage(error)) } finally { setRefreshing(false) }
  }

  async function refreshMaterial(materialId: string) {
    if (!session || refreshing) return
    setRefreshing(true)
    try {
      const next = await verificationApi.getMaterial(session, materialId)
      setMaterials(current => current.map(material => material.material_id === materialId ? next : material))
      setOperationError(null)
    } catch (error) { setOperationError(errorMessage(error)) } finally { setRefreshing(false) }
  }

  async function ensureDraft(): Promise<VerificationRequestProjection> {
    if (!session || !project) throw new Error('SESSION_REQUIRED')
    const body = {
      creator_resolution_mode: resolution,
      creator_account_link_id: resolution === 'use_existing_link' ? selectedLinkId : null,
      target_creator_id: null,
      new_creator_profile_input: profileInput(),
      requested_link_role: resolution === 'use_existing_link' ? null : 'owner' as const,
    }
    let current = request
    if (!current || current.status === 'failed' || current.status === 'withdrawn') {
      current = await verificationApi.create(session, {
        project_id: String(project.id),
        supersedes_verification_id: current?.verification_id ?? supersedesVerificationId,
        idempotency_key: undefined,
        ...body,
      })
      draftPatchPending.current = true
      setRequest(current)
      setStartingOver(false)
      setSupersedesVerificationId(null)
      setMaterials([...current.material_summaries])
      setParams(previous => { const next = new URLSearchParams(previous); next.set('verification_id', current!.verification_id); return next }, { replace: true })
    }
    const patched = await verificationApi.patch(session, current.verification_id, {
      expected_version: current.version,
      ...body,
      method: 'manual_material',
      public_summary: summary.trim(),
    })
    draftPatchPending.current = false
    setRequest(patched)
    setStartingOver(false)
    setSupersedesVerificationId(null)
    setParams(previous => { const next = new URLSearchParams(previous); next.set('verification_id', patched.verification_id); return next }, { replace: true })
    return patched
  }

  async function uploadSelectedMaterial(verificationIdToUse: string): Promise<VerificationMaterialSummary> {
    if (!session || !file) throw new Error('MATERIAL_REQUIRED')
    const checksum = await digestFile(file)
    const prepared = await verificationApi.prepareMaterial(session, {
      verification_id: verificationIdToUse,
      declared_mime: file.type,
      byte_size: file.size,
      checksum,
    })
    await verificationApi.uploadMaterial(prepared, file)
    await verificationApi.completeMaterial(session, prepared.material.material_id, { checksum, upload_receipt: 'browser-upload-complete' })
    const material = await verificationApi.getMaterial(session, prepared.material.material_id)
    setMaterials(current => [...current.filter(item => item.material_id !== material.material_id), material])
    setFile(null)
    return material
  }

  async function submit() {
    if (!session || !project || busy) return
    const message = validate()
    if (message) { setValidation(message); return }
    setValidation(null)
    setOperationError(null)
    setBusy(true)
    try {
      const current = await ensureDraft()
      const uploaded = file ? await uploadSelectedMaterial(current.verification_id) : null
      const currentMaterials = uploaded ? [...accepted, uploaded] : accepted
      const readyIds = acceptedMaterial(currentMaterials).map(material => material.material_id)
      if (!readyIds.length) {
        setOperationError('材料正在扫描中，请点击材料旁的“检查材料状态”，扫描通过后再提交。')
        return
      }
      const next = current.status === 'changes_requested'
        ? await verificationApi.supplement(session, current.verification_id, current.version, readyIds)
        : await verificationApi.submit(session, current.verification_id, current.version, readyIds)
      setRequest(next)
      setSupersedesVerificationId(null)
      setMaterials([...next.material_summaries])
      pushToast('身份材料已提交，正在等待人工审核。', 'success')
    } catch (error) {
      setOperationError(errorMessage(error))
    } finally { setBusy(false) }
  }

  async function withdraw() {
    if (!session || !request || busy) return
    setBusy(true)
    try {
      const next = await verificationApi.withdraw(session, request.verification_id, request.version)
      setRequest(next)
      setSupersedesVerificationId(next.status === 'failed' || next.status === 'withdrawn' ? next.verification_id : null)
      pushToast('身份申请已撤回。', 'success')
    } catch (error) { setOperationError(errorMessage(error)) } finally { setBusy(false) }
  }

  if (!session) {
    const from = encodeURIComponent(`${location.pathname}${location.search}`)
    return <PageFrame title="开发者身份确认" description="确认后，你可以管理和更新自己的作品信息。"><section className="submit-login-callout stack"><h2>请先登录后提交身份材料</h2><p>登录后会回到当前作品，材料不会公开展示。</p><Link className="button button--primary" to={`/auth?return_to=${from}`}>登录并继续</Link><Link to={`/project/${id}`}>先查看作品详情</Link></section></PageFrame>
  }
  if (loading) return <main className="page-container"><LoadingState label="开发者身份页面加载中" /></main>
  if (loadError || !project) {
    const message = operationError ?? loadError?.message ?? '未找到作品'
    return <main className="page-container stack"><ErrorPanel title={operationError || loadError ? '页面加载失败' : '未找到作品'} message={message} onRetry={operationError || loadError ? retryLoad : undefined} /><Link to="/projects">返回作品广场</Link></main>
  }

  return (
    <PageFrame title="认领作品" description={`确认你与“${projectName}”的关系，完成后即可管理作品信息。`}>
      <div className="verification-layout author-verification-page">
        <section className="stack">
          <aside className="submission-guidance stack stack--small"><strong>材料如何使用</strong><p>材料只供审核人员确认开发者与作品的关系，不会显示在作品详情或开发者主页中。</p></aside>
          {request && !canEdit && !canStartOver ? <section className={`verification-status verification-status--${request.status} stack`} aria-live="polite"><div className="cluster cluster--between"><h2>{statusLabels[request.status]}</h2><Tag tone={request.status === 'verified' ? 'strong' : 'dashed'}>申请 {request.verification_id}</Tag></div><p>{statusMessages[request.status]}</p>{request.latest_public_review_message ? <p>审核意见已更新，请按页面提示补充材料。</p> : null}{request.status === 'pending' ? <div className="cluster"><Button disabled={refreshing} onClick={() => void refreshRequest()}>刷新申请状态</Button><Button variant="quiet" disabled={busy} onClick={() => void withdraw()}>撤回申请</Button></div> : null}{request.status === 'verified' ? <Link className="button button--primary" to={`/project/${project.id}/update`}>管理作品</Link> : null}</section> : null}
          {canStartOver ? <section className="feedback stack stack--small"><strong>{statusLabels[request!.status]}</strong><p>{statusMessages[request!.status]}</p><Button onClick={() => { setStartingOver(true); setSupersedesVerificationId(request!.verification_id); setRequest(null); setMaterials([]); setOperationError(null); setValidation(null) }}>重新申请</Button></section> : null}
          {canEdit ? <>
            <section className="wire-panel stack" aria-labelledby="developer-profile-heading"><div><h2 id="developer-profile-heading">开发主体</h2><p className="page-description">每个作品归属一位开发者或一个开发团队。</p></div>{ownerLinks.length ? <fieldset className="submission-choice-field"><legend>身份来源</legend><label className="choice-card"><input type="radio" name="verification-resolution" checked={resolution === 'create_new_creator'} onChange={() => setResolution('create_new_creator')} /><span><strong>新建开发者身份</strong><small>为这个作品创建个人或团队资料</small></span></label><label className="choice-card"><input type="radio" name="verification-resolution" checked={resolution === 'use_existing_link'} onChange={() => setResolution('use_existing_link')} /><span><strong>复用已有开发者身份</strong><small>沿用你已经确认的开发者资料</small></span></label></fieldset> : null}{resolution === 'use_existing_link' ? <label className="field" htmlFor="developer-link"><span className="field__label">已有开发者身份</span><select id="developer-link" className="input" value={selectedLinkId} onChange={event => setSelectedLinkId(event.target.value)}><option value="">请选择</option>{ownerLinks.map(link => <option key={link.creator_account_link_id} value={link.creator_account_link_id}>{link.creator_id}</option>)}</select></label> : <><fieldset className="submission-choice-field"><legend>开发主体类型</legend><div className="verification-kind-grid"><label className="choice-card"><input type="radio" name="developer-kind" checked={kind === 'individual'} onChange={() => setKind('individual')} /><span><strong>个人开发</strong><small>展示个人开发者名称</small></span></label><label className="choice-card"><input type="radio" name="developer-kind" checked={kind === 'team'} onChange={() => setKind('team')} /><span><strong>团队开发</strong><small>展示团队名称与 Logo</small></span></label></div></fieldset><label className="field" htmlFor="developer-display-name"><span className="field__label">{kind === 'team' ? '团队名称' : '开发者名称'}</span><input id="developer-display-name" className="input" value={displayName} maxLength={80} onChange={event => setDisplayName(event.target.value)} required /></label><label className="field" htmlFor="developer-bio"><span className="field__label">简介（可选）</span><textarea id="developer-bio" className="input textarea" rows={3} value={bio} maxLength={1000} onChange={event => setBio(event.target.value)} /></label><label className="field" htmlFor="developer-avatar-url"><span className="field__label">头像或团队 Logo 地址（可选）</span><input id="developer-avatar-url" className="input" type="url" value={avatarUrl} onChange={event => setAvatarUrl(event.target.value)} placeholder="https://" /></label><label className="field" htmlFor="developer-website-url"><span className="field__label">官网（可选）</span><input id="developer-website-url" className="input" type="url" value={websiteUrl} onChange={event => setWebsiteUrl(event.target.value)} placeholder="https://" /></label></>}</section>
            <section className="wire-panel stack" aria-labelledby="verification-material-heading"><div><h2 id="verification-material-heading">身份材料</h2><p className="page-description">仅支持 PDF、JPG、PNG。材料会先扫描，扫描通过后才能提交人工审核。</p></div><label className="field" htmlFor="verification-summary"><span className="field__label">材料说明</span><textarea id="verification-summary" className="input textarea" rows={4} value={summary} onChange={event => { setSummary(event.target.value); setValidation(null) }} placeholder="说明材料如何证明你与这个作品的关系" /></label><label className="field" htmlFor="verification-file"><span className="field__label">上传证明材料</span><input id="verification-file" className="input" type="file" accept="application/pdf,image/jpeg,image/png" onChange={event => { setFile(event.target.files?.[0] ?? null); setValidation(null) }} /></label>{materials.length ? <ul className="verification-material-list">{materials.map(material => <li key={material.material_id}><span><strong>{material.applicant_scan_state === 'accepted' ? '扫描通过' : material.applicant_scan_state === 'rejected' ? '材料不可用' : '扫描中'}</strong><small>{material.material_id}</small></span>{material.applicant_scan_state !== 'accepted' ? <Button variant="quiet" disabled={refreshing} onClick={() => void refreshMaterial(material.material_id)}>检查材料状态</Button> : <Tag tone="strong">可提交</Tag>}</li>)}</ul> : null}{validation ? <p className="field-error" role="alert">{validation}</p> : null}<Button variant="primary" type="button" disabled={busy} onClick={() => void submit()}>{busy ? '提交中…' : request?.status === 'changes_requested' ? '补充材料并提交' : '提交身份审核'}</Button></section>
          </> : null}
          {operationError ? <ErrorPanel title="身份申请未完成" message={operationError} onRetry={request ? () => void refreshRequest() : undefined} /> : null}
          {request && canEdit ? <Button variant="quiet" disabled={busy} onClick={() => void withdraw()}>撤回申请草稿</Button> : null}
        </section>
        <aside className="wire-panel stack verification-boundary"><h2>权限影响</h2><dl className="definition-list"><div><dt>开发主体</dt><dd>{resolution === 'use_existing_link' ? '复用已有身份' : kind === 'team' ? '开发团队' : '个人开发者'}</dd></div><div><dt>管理权限</dt><dd>{request?.status === 'verified' ? '已开放' : '审核通过后开放'}</dd></div><div><dt>公开展示</dt><dd>仅展示开发者或团队资料</dd></div><div><dt>历史记录</dt><dd>保持不变</dd></div></dl><Link to={`/project/${project.id}`}>返回作品详情</Link></aside>
      </div>
    </PageFrame>
  )
}
