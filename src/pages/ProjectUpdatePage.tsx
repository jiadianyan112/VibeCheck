import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { Button, ConfirmDialog, ErrorPanel, LoadingState, PageFrame, Tag, useToast } from '../components'
import {
  canUserUpdateProject,
  followerNotifications,
  projectUpdateSourceLabels,
  projectUpdateTypeLabels,
  publishedProjectFromSubmission,
  type ProjectUpdateInput,
} from '../features'
import { resolveServiceScenario, userAssets } from '../mocks'
import { DeveloperApiError, developerApi, projectService, projectUpdateApi, projectUpdateService, ProjectUpdateApiError, type MyProjectItem, type ServiceError } from '../services'
import { useAuthSession } from '../features/auth/AuthSessionContext'
import { useAppState } from '../state'
import {
  assetTypes,
  projectUpdateSourceTypes,
  projectUpdateTypes,
  type AccessStatus,
  type AssetType,
  type Project,
  type ProjectUpdateType,
} from '../types'
import { accessStatusText } from '../utils'

const assetTypeLabels: Record<AssetType, string> = {
  source_code: '源代码', starter: 'Starter', template: '模板', component: '组件', page_layout: '页面布局', ui_component: 'UI 组件', motion_interaction: '动画/交互', theme_design_system: '主题/设计系统', resume_module: '简历模块', blog_cms_module: '博客/CMS 模块', prompt: '提示词', parsing_solution: '解析方案', open_api: '开放 API', deployment_solution: '部署方案', deployment_config: '部署配置', design_file: '设计稿', other: '其他',
}
const authorStatusOptions: AccessStatus[] = ['normal', 'recovered', 'paused', 'ended']

function resolvedType(value: string | null): ProjectUpdateType {
  if (value === 'product' || value === 'development') return 'description'
  return projectUpdateTypes.includes(value as ProjectUpdateType) ? value as ProjectUpdateType : 'version'
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '无公开前值'
  if (Array.isArray(value)) return value.join('、') || '空列表'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function LegacyProjectUpdatePage() {
  const { id } = useParams()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const { state, dispatch } = useAppState()
  const { pushToast } = useToast()
  const storedDraft = state.projectUpdateDrafts.find((draft) => draft.projectId === id && draft.userId === state.session.user?.id)
  const queryType = params.get('type')
  const type = queryType ? resolvedType(queryType) : storedDraft?.input.type ?? 'version'
  const shouldRestore = Boolean(storedDraft && (!queryType || storedDraft.input.type === type))
  const scenario = resolveServiceScenario(params, state.serviceScenario)
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<ServiceError | null>(null)
  const [operationError, setOperationError] = useState<ServiceError | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [validation, setValidation] = useState<string | null>(null)
  const [completedEventId, setCompletedEventId] = useState<string | null>(null)
  const [value, setValue] = useState(shouldRestore ? storedDraft!.input.value : '')
  const [sourceType, setSourceType] = useState<ProjectUpdateInput['sourceType']>(shouldRestore ? storedDraft!.input.sourceType : 'author_statement')
  const [sourceSummary, setSourceSummary] = useState(shouldRestore ? storedDraft!.input.sourceSummary : '')
  const [impactScope, setImpactScope] = useState(shouldRestore ? storedDraft!.input.impactScope : '')
  const [terminalDeclared, setTerminalDeclared] = useState(shouldRestore ? storedDraft!.input.terminalDeclared : false)
  const [assetName, setAssetName] = useState(shouldRestore ? storedDraft!.input.assetName : '')
  const [assetType, setAssetType] = useState<AssetType>(shouldRestore ? storedDraft!.input.assetType : 'source_code')
  const [assetLicense, setAssetLicense] = useState(shouldRestore ? storedDraft!.input.assetLicense : '')

  useEffect(() => {
    const override = state.projectOverrides.find((item) => item.id === id)
    if (override) { setProject(override); setLoading(false); setLoadError(null); return }
    const submitted = state.submissionDrafts.find((draft) => draft.publishedProjectId === id)
    const submittedProject = submitted ? publishedProjectFromSubmission(submitted) : null
    if (submittedProject) { setProject(submittedProject); setLoading(false); setLoadError(null); return }
    let active = true
    setLoading(true)
    projectService.getById(id as Project['id'], { scenario: state.serviceScenario }).then((result) => {
      if (!active) return
      if (result.ok) { setProject(result.data); setLoadError(null) } else setLoadError(result.error)
      setLoading(false)
    })
    return () => { active = false }
  }, [id, state.projectOverrides, state.serviceScenario, state.submissionDrafts])

  useEffect(() => {
    if (!id || !state.session.user) return
    dispatch({
      type: 'PROJECT_UPDATE_DRAFT_UPSERT',
      draft: {
        id: `project-update-draft-${state.session.user.id}-${id}`,
        projectId: id as Project['id'],
        userId: state.session.user.id,
        input: { type, value, sourceType, sourceSummary, impactScope, terminalDeclared, assetName, assetType, assetLicense },
        lastErrorCode: operationError?.code ?? null,
        updatedAt: '2026-07-31T11:55:00+08:00',
      },
    })
  }, [assetLicense, assetName, assetType, dispatch, id, impactScope, operationError?.code, sourceSummary, sourceType, state.session.user, terminalDeclared, type, value])

  const permission = useMemo(() => project ? canUserUpdateProject(project, state.session.user, state.verificationRequests) : { allowed: false, disputed: false }, [project, state.session.user, state.verificationRequests])
  const beforeValue = useMemo(() => {
    if (!project) return null
    if (type === 'version') return project.versionIds.at(-1) ?? null
    if (type === 'address') return project.publicUrl.state === 'known' ? project.publicUrl.value : null
    if (type === 'status') return project.accessStatus.state === 'known' ? accessStatusText[project.accessStatus.value] : '状态未知'
    if (type === 'description') return project.oneLineDefinition.state === 'known' ? project.oneLineDefinition.value : null
    return project.assetIds.length ? `${project.assetIds.length} 项现有资产` : '暂无公开资产'
  }, [project, type])

  function selectType(next: ProjectUpdateType) {
    const nextParams = new URLSearchParams(params); nextParams.set('type', next); setParams(nextParams)
    setValue(''); setValidation(null); setTerminalDeclared(false); setCompletedEventId(null)
  }

  function validate() {
    if (!value.trim()) return type === 'asset' ? '请填写资产公开地址。' : '请填写更新后的内容。'
    if (!sourceSummary.trim()) return '请说明更新来源。'
    if (!impactScope.trim()) return '请说明此次更新影响哪些公开内容。'
    if (type === 'address') { try { new URL(value) } catch { return '请输入完整的 http 或 https 地址。' } }
    if (type === 'status' && (value === 'paused' || value === 'ended') && !terminalDeclared) return '暂停或结束必须由开发者明确勾选声明。'
    return null
  }

  function requestSubmit() {
    const message = validate()
    if (message) { setValidation(message); return }
    setValidation(null); setConfirming(true)
  }

  async function submit() {
    if (!project || !state.session.user || !permission.allowed) return
    setConfirming(false)
    setBusy(true)
    const response = await projectUpdateService.submit(project, state.session.user, { type, value, sourceType, sourceSummary, impactScope, terminalDeclared, assetName, assetType, assetLicense }, { scenario })
    setBusy(false)
    if (!response.ok) { setOperationError(response.error); return }
    setOperationError(null)
    const notifications = followerNotifications(response.data.project, response.data.event, state.session.user, userAssets)
    dispatch({ type: 'PROJECT_UPDATE_APPLY', ...response.data, notifications })
    setProject(response.data.project)
    setCompletedEventId(response.data.event.id)
    pushToast('更新已同步到作品详情、作品时间线和最新动态。', 'success')
  }

  if (!state.session.user) {
    return <PageFrame title="作品更新" description="更新作品需要已验证的作者管理权限。"><section className="submit-login-callout stack"><h2>请先登录</h2><Link className="button button--primary" to={`/auth?return_to=${encodeURIComponent(`${location.pathname}${location.search}`)}`}>登录并继续</Link></section></PageFrame>
  }
  if (loading) return <main className="page-container"><LoadingState label="作品更新权限加载中" /></main>
  if (loadError || !project) return <main className="page-container stack"><ErrorPanel message={loadError?.message ?? '未找到作品'} /><Link to="/projects">返回作品广场</Link></main>
  if (!permission.allowed) return <PageFrame title="没有此作品的更新权限" description={permission.disputed ? '作者归属存在争议，高风险编辑已冻结。' : '身份验证只用于取得管理权限；普通纠错不要求声明作者身份。'}><div className="cluster"><Link className="button button--primary" to={`/project/${project.id}/verify-author`}>{permission.disputed ? '查看归属争议状态' : '申请作者身份验证'}</Link><Link className="button" to="/about#corrections">提交公开纠错</Link><Link to={`/project/${project.id}`}>返回作品详情</Link></div></PageFrame>

  const projectName = project.currentName.state === 'known' ? project.currentName.value : '名称未知的作品'
  const afterPreview = type === 'asset' ? '复用资产更新暂不可用' : type === 'status' && value ? accessStatusText[value as AccessStatus] : value || '尚未填写'
  return (
    <PageFrame title={`更新 ${projectName}`} description="提交后会同步到作品详情和最新动态，之前的信息仍可在时间线中查看。">
      <div className="project-update-layout">
        <aside className="project-update-menu stack stack--small"><strong>选择更新内容</strong>{projectUpdateTypes.map((item) => <Button key={item} variant={item === type ? 'primary' : 'quiet'} aria-pressed={item === type} onClick={() => selectType(item)}>{projectUpdateTypeLabels[item]}</Button>)}</aside>
        <section className="stack">
          <div className="wire-panel stack"><div className="cluster cluster--between"><h2>{projectUpdateTypeLabels[type]}</h2><Tag>已验证作者</Tag></div>
            {type === 'version' ? <label className="field"><span className="field__label">新版本名称或编号</span><input className="input" value={value} onChange={(event) => setValue(event.target.value)} placeholder="例如 2.1 · 练习报告更新" /></label> : null}
            {type === 'address' ? <label className="field"><span className="field__label">新公开地址</span><input className="input" value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://" /></label> : null}
            {type === 'status' ? <><label className="field"><span className="field__label">新作品状态</span><select className="input" value={value} onChange={(event) => { setValue(event.target.value); setTerminalDeclared(false) }}><option value="">请选择</option>{authorStatusOptions.map((status) => <option key={status} value={status}>{accessStatusText[status]}</option>)}</select></label>{value === 'paused' || value === 'ended' ? <label className="choice-card"><input type="checkbox" checked={terminalDeclared} onChange={(event) => setTerminalDeclared(event.target.checked)} /><span>我明确声明该作品{value === 'paused' ? '暂停维护' : '已经结束'}；这不是由技术异常自动推断。</span></label> : null}</> : null}
            {type === 'description' ? <label className="field"><span className="field__label">新的一句话说明</span><textarea className="input textarea" rows={4} value={value} onChange={(event) => setValue(event.target.value)} /></label> : null}
            {type === 'asset' ? <div className="stack"><label className="field"><span className="field__label">资产名称</span><input className="input" value={assetName} onChange={(event) => setAssetName(event.target.value)} /></label><label className="field"><span className="field__label">资产类型</span><select className="input" value={assetType} onChange={(event) => setAssetType(event.target.value as AssetType)}>{assetTypes.map((item) => <option key={item} value={item}>{assetTypeLabels[item]}</option>)}</select></label><label className="field"><span className="field__label">资产公开地址</span><input className="input" value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://" /></label><label className="field"><span className="field__label">许可证（可选）</span><input className="input" value={assetLicense} onChange={(event) => setAssetLicense(event.target.value)} /></label></div> : null}
          </div>

          <section className="update-diff-preview stack"><div><h2>确认更新内容</h2></div><div className="update-diff-grid"><article><strong>更新前</strong><p>{displayValue(beforeValue)}</p></article><article><strong>更新后</strong><p>{afterPreview}</p></article></div><p>提交后仍可在作品时间线中查看更新前的内容。</p></section>

          <section className="wire-panel stack"><h2>来源与影响范围</h2><label className="field"><span className="field__label">来源类型</span><select className="input" value={sourceType} onChange={(event) => setSourceType(event.target.value as ProjectUpdateInput['sourceType'])}>{projectUpdateSourceTypes.map((item) => <option key={item} value={item}>{projectUpdateSourceLabels[item]}</option>)}</select></label><label className="field"><span className="field__label">来源说明</span><textarea className="input textarea" rows={3} value={sourceSummary} onChange={(event) => setSourceSummary(event.target.value)} placeholder="说明公开页面、仓库或开发者声明中的依据" /></label><label className="field"><span className="field__label">影响范围</span><textarea className="input textarea" rows={3} value={impactScope} onChange={(event) => setImpactScope(event.target.value)} placeholder="说明详情、访问入口、使用者或复用方会受到什么影响" /></label></section>
          {validation ? <p className="field-error" role="alert">{validation}</p> : null}
          {operationError ? <div className="stack"><ErrorPanel title="更新提交未完成" message={operationError.message} onRetry={operationError.retryable ? submit : undefined} />{operationError.code === 'VC_UPDATE_PERMISSION_EXPIRED' ? <Link className="button" to={`/project/${project.id}/verify-author`}>重新验证作者权限</Link> : null}</div> : null}
          {completedEventId ? <section className="feedback stack stack--small" role="status"><strong>更新已发布</strong><p>内容已同步到作品详情和最新动态，关注者也会收到通知。</p><div className="cluster"><Link className="button button--primary" to={`/project/${project.id}#${completedEventId}`}>在详情中查看</Link><Link className="button" to={`/activity#${completedEventId}`}>在动态中查看</Link></div></section> : null}
          <Button variant="primary" disabled={busy || Boolean(completedEventId)} onClick={requestSubmit}>{busy ? '提交中…' : completedEventId ? '本次更新已提交' : '预览确认并提交更新'}</Button>
        </section>
      </div>
      <ConfirmDialog open={confirming} title={`确认提交${projectUpdateTypeLabels[type]}？`} description="提交后会更新作品详情、最新动态，并通知关注者。" confirmLabel="确认提交更新" onConfirm={() => void submit()} onCancel={() => setConfirming(false)} />
    </PageFrame>
  )
}

type RemoteUpdateType = 'version' | 'address' | 'status' | 'asset' | 'description'

const remoteFieldPath: Partial<Record<RemoteUpdateType, string>> = {
  version: '/project_core/status_note',
  status: '/project_core/access_status',
  description: '/project_core/one_line_definition',
}

const remoteTypeLabels: Record<RemoteUpdateType, string> = {
  version: '版本说明',
  address: '公开地址迁移',
  status: projectUpdateTypeLabels.status,
  asset: projectUpdateTypeLabels.asset,
  description: projectUpdateTypeLabels.description,
}

const terminalRemoteStatuses = new Set(['applied', 'rejected', 'withdrawn'] as const)

function remoteTypeLabel(type: RemoteUpdateType) {
  return remoteTypeLabels[type]
}

function payloadValue(
  draft: import('../services/projectUpdateApi').ProjectUpdateProjection,
  fieldPath: string,
) {
  return draft.payload_diff.find((diff) => diff.field_path === fieldPath)?.after_value
}

function remoteRequestId(prefix: string) {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${id}`.slice(0, 128)
}

function remoteErrorMessage(error: unknown): string {
  if (error instanceof DeveloperApiError || error instanceof ProjectUpdateApiError) {
    if (error.status === 401 || error.code === 'AUTH_REQUIRED') return '登录状态已失效，请重新登录后继续。'
    if (error.status === 403 || error.code.includes('AUTHORIZATION_REVOKED') || error.code.includes('PERMISSION')) return '作品管理权限已撤销，请重新完成身份认证。'
    if (error.status === 409 || error.code.includes('CONFLICT') || error.code.includes('STALE')) return '作品版本已经发生变化，请重新加载后再提交，当前输入已保留。'
    if (error.status === 404) return '这项作品更新草稿已不存在，请重新加载作品。'
    if (error.status >= 500 || error.status === 0) return '更新服务暂时不可用，请稍后重试，当前输入已保留。'
  }
  if (error instanceof DOMException && error.name === 'AbortError') return '请求已取消。'
  return '更新暂时无法完成，请稍后重试，当前输入已保留。'
}

function remoteProjectName(project: Project): string {
  return project.currentName.state === 'known' ? project.currentName.value : '名称未知的作品'
}

function remoteUpdateValue(type: RemoteUpdateType, input: Pick<ProjectUpdateInput, 'value'>): unknown {
  if (type === 'asset') return input.value.trim()
  if (type === 'status') return input.value
  return input.value.trim()
}

function remoteBeforeValue(project: Project, type: RemoteUpdateType): unknown {
  if (type === 'version') return project.statusNote.state === 'known' ? project.statusNote.value : null
  if (type === 'address') return project.publicUrl.state === 'known' ? project.publicUrl.value : null
  if (type === 'status') return project.accessStatus.state === 'known' ? project.accessStatus.value : null
  if (type === 'description') return project.oneLineDefinition.state === 'known' ? project.oneLineDefinition.value : null
  return null
}

function RemoteProjectUpdatePage() {
  const { id } = useParams()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const { state } = useAppState()
  const auth = useAuthSession()
  const { pushToast } = useToast()
  const user = state.session.user
  const userId = user?.id ?? auth.session?.user_id ?? null
  const storedType = params.get('type')
  const type = resolvedType(storedType) as RemoteUpdateType
  const [project, setProject] = useState<Project | null>(null)
  const [access, setAccess] = useState<MyProjectItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [operationFailure, setOperationFailure] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [validation, setValidation] = useState<string | null>(null)
  const [remoteDraft, setRemoteDraft] = useState<import('../services/projectUpdateApi').ProjectUpdateProjection | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [value, setValue] = useState('')
  const [sourceType, setSourceType] = useState<ProjectUpdateInput['sourceType']>('author_statement')
  const [sourceSummary, setSourceSummary] = useState('')
  const [impactScope, setImpactScope] = useState('')
  const [terminalDeclared, setTerminalDeclared] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const unsupported = type === 'address' || type === 'asset'

  const reload = useCallback(() => {
    setReloadKey((current) => current + 1)
    setOperationError(null)
    setOperationFailure(null)
  }, [])

  useEffect(() => {
    if (!id || !userId) return undefined
    const controller = new AbortController()
    let active = true
    setLoading(true)
    setLoadError(null)
    setProject(null)
    setAccess(null)
    setRemoteDraft(null)
    setSubmitted(false)

    const load = async () => {
      try {
        const [projectResult, page] = await Promise.all([
          projectService.getById(id as Project['id'], { signal: controller.signal }),
          developerApi.listMyProjects({ projectId: id, limit: 1, signal: controller.signal }),
        ])
        if (!active || controller.signal.aborted) return
        if (!projectResult.ok) {
          setLoadError(projectResult.error.message)
          return
        }
        const item = page.items.find((candidate) => candidate.project_id === id) ?? null
        setProject(projectResult.data)
        setAccess(item)
        const storageKey = `vibecheck:project-update:${userId}:${id}:${type}`
        const storedUpdateId = !unsupported && typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(storageKey) : null
        if (storedUpdateId) {
          try {
            const saved = await projectUpdateApi.get({ updateId: storedUpdateId, signal: controller.signal })
            if (!active || controller.signal.aborted) return
            if (saved.project_id === id) {
              setRemoteDraft(saved)
              const savedValue = saved.update_type === 'version'
                ? payloadValue(saved, '/project_core/status_note')
                : saved.update_type === 'status'
                  ? payloadValue(saved, '/project_core/access_status')
                  : saved.update_type === 'description'
                    ? payloadValue(saved, '/project_core/one_line_definition')
                    : undefined
              if (savedValue !== undefined) setValue(typeof savedValue === 'string' ? savedValue : savedValue == null ? '' : String(savedValue))
              const isTerminal = terminalRemoteStatuses.has(saved.status as 'applied' | 'rejected' | 'withdrawn')
              if (isTerminal && typeof sessionStorage !== 'undefined') sessionStorage.removeItem(storageKey)
              setSubmitted(!isTerminal && (saved.status === 'update_pending' || saved.status === 'approved' || saved.status === 'applying'))
            }
          } catch (error) {
            if (error instanceof ProjectUpdateApiError && error.status === 404 && typeof sessionStorage !== 'undefined') sessionStorage.removeItem(`vibecheck:project-update:${userId}:${id}:${type}`)
          }
        }
      } catch (error) {
        if (!active || controller.signal.aborted) return
        setLoadError(remoteErrorMessage(error))
      } finally {
        if (active && !controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => { active = false; controller.abort() }
  }, [id, reloadKey, type, unsupported, userId])

  const beforeValue = useMemo(() => project ? remoteBeforeValue(project, type) : null, [project, type])
  const afterPreview = type === 'asset' ? '复用资产更新暂不可用' : type === 'status' && value ? accessStatusText[value as AccessStatus] : value || '尚未填写'

  function selectType(next: RemoteUpdateType) {
    const nextParams = new URLSearchParams(params)
    nextParams.set('type', next)
    setParams(nextParams)
    resetRemoteInput()
    setRemoteDraft(null)
    setSubmitted(false)
  }

  function resetRemoteInput() {
    setValue('')
    setSourceType('author_statement')
    setSourceSummary('')
    setImpactScope('')
    setValidation(null)
    setOperationError(null)
    setOperationFailure(null)
    setTerminalDeclared(false)
  }

  async function startNewUpdate() {
    if (!project || !access?.can_manage || !userId || !auth.session || creating || unsupported) return
    const baseVersionId = project.versionIds.at(-1)
    if (!baseVersionId) {
      setOperationError('当前作品缺少可用版本，暂时无法创建更新草稿。')
      return
    }
    setCreating(true)
    setOperationError(null)
    setOperationFailure(null)
    try {
      const next = await projectUpdateApi.create({
        session: auth.session,
        projectId: String(project.id),
        updateType: type,
        baseVersionId: String(baseVersionId),
        clientRequestId: remoteRequestId(`project-update-create-${userId}-${project.id}`),
      })
      setRemoteDraft(next)
      setSubmitted(false)
      resetRemoteInput()
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(`vibecheck:project-update:${userId}:${project.id}:${type}`, next.update_id)
      pushToast('已创建新的更新草稿。', 'success')
    } catch (error) {
      setOperationFailure(error)
      setOperationError(remoteErrorMessage(error))
    } finally {
      setCreating(false)
    }
  }

  function validate() {
    if (!value.trim()) return type === 'asset' ? '请填写资产公开地址。' : '请填写更新后的内容。'
    if (!sourceSummary.trim()) return '请说明更新来源。'
    if (!impactScope.trim()) return '请说明此次更新影响哪些公开内容。'
    if (type === 'address') { try { new URL(value) } catch { return '请输入完整的 http 或 https 地址。' } }
    if (type === 'status' && (value === 'paused' || value === 'ended') && !terminalDeclared) return '暂停或结束必须由开发者明确勾选声明。'
    if (type === 'asset') return '当前更新权限暂不支持直接新增复用资产，请先完成资产证据准备。'
    return null
  }

  function requestSubmit() {
    const message = validate()
    if (message) { setValidation(message); return }
    setValidation(null)
    setConfirming(true)
  }

  async function submitRemote() {
    if (!project || !access?.can_manage || !userId || !auth.session || busy) return
    setConfirming(false)
    setBusy(true)
    setOperationError(null)
    setOperationFailure(null)
    try {
      const baseVersionId = project.versionIds.at(-1)
      if (!baseVersionId) throw new ProjectUpdateApiError('PROJECT_UPDATE_BASE_VERSION_MISSING', 409)
      let current = remoteDraft
      if (!current) {
        current = await projectUpdateApi.create({
          session: auth.session,
          projectId: String(project.id),
          updateType: type,
          baseVersionId: String(baseVersionId),
          clientRequestId: remoteRequestId(`project-update-create-${userId}-${project.id}`),
        })
        setRemoteDraft(current)
        if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(`vibecheck:project-update:${userId}:${project.id}:${type}`, current.update_id)
      }
      const fieldPath = remoteFieldPath[type]
      if (!fieldPath || !current.effective_field_paths.includes(fieldPath)) {
        throw new ProjectUpdateApiError('PROJECT_UPDATE_FIELD_NOT_ALLOWED', 403)
      }
      const diffs = [{ field_path: fieldPath, after_value: remoteUpdateValue(type, { value }) }]
      if (type === 'status' && sourceSummary.trim() && current.effective_field_paths.includes('/project_core/status_note')) {
        diffs.push({ field_path: '/project_core/status_note', after_value: sourceSummary.trim() })
      }
      const patched = await projectUpdateApi.patch({
        session: auth.session,
        updateId: current.update_id,
        expectedVersion: current.version,
        diff: diffs,
        evidenceDraftIds: current.evidence_draft_ids,
        mediaReferenceIds: current.media_reference_ids,
        operationId: remoteRequestId('project-update-patch'),
      })
      setRemoteDraft(patched)
      const preview = await projectUpdateApi.preview({ session: auth.session, updateId: patched.update_id, expectedVersion: patched.version })
      const result = await projectUpdateApi.submit({
        session: auth.session,
        updateId: preview.update_id,
        version: preview.version,
        previewHash: preview.preview_hash,
        submissionKey: remoteRequestId('project-update-submit'),
      })
      setSubmitted(true)
      setRemoteDraft({ ...patched, status: result.status, version: result.version, updated_at: result.submitted_at })
      pushToast('更新已提交审核。', 'success')
    } catch (error) {
      setOperationFailure(error)
      setOperationError(remoteErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function refreshSubmission() {
    if (!remoteDraft || !auth.session || busy) return
    setBusy(true)
    setOperationError(null)
    try {
      const current = await projectUpdateApi.get({ updateId: remoteDraft.update_id })
      setRemoteDraft(current)
      const savedValue = current.update_type === 'version'
        ? payloadValue(current, '/project_core/status_note')
        : current.update_type === 'status'
          ? payloadValue(current, '/project_core/access_status')
          : current.update_type === 'description'
            ? payloadValue(current, '/project_core/one_line_definition')
            : undefined
      if (savedValue !== undefined) setValue(typeof savedValue === 'string' ? savedValue : savedValue == null ? '' : String(savedValue))
      const isTerminal = terminalRemoteStatuses.has(current.status as 'applied' | 'rejected' | 'withdrawn')
      if (isTerminal && typeof sessionStorage !== 'undefined' && userId && id) sessionStorage.removeItem(`vibecheck:project-update:${userId}:${id}:${type}`)
      if (current.status === 'applied') {
        const refreshed = await projectService.getById(current.project_id as Project['id'])
        if (refreshed.ok) setProject(refreshed.data)
        setSubmitted(false)
        pushToast('更新已通过审核并应用。', 'success')
      } else {
        setSubmitted(!isTerminal && (current.status === 'update_pending' || current.status === 'approved' || current.status === 'applying'))
      }
    } catch (error) {
      setOperationFailure(error)
      setOperationError(remoteErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function withdrawRemote() {
    if (!remoteDraft || !auth.session || busy || remoteDraft.status !== 'update_pending') return
    setBusy(true)
    setOperationError(null)
    try {
      const withdrawn = await projectUpdateApi.withdraw({
        session: auth.session,
        updateId: remoteDraft.update_id,
        expectedVersion: remoteDraft.version,
        operationId: remoteRequestId('project-update-withdraw'),
        reasonCode: 'owner_cancelled',
      })
      if (typeof sessionStorage !== 'undefined' && userId && id) sessionStorage.removeItem(`vibecheck:project-update:${userId}:${id}:${type}`)
      setRemoteDraft({ ...remoteDraft, status: withdrawn.status, version: withdrawn.version, review_work_item_id: withdrawn.review_work_item_id, updated_at: withdrawn.withdrawn_at })
      setSubmitted(false)
      pushToast('更新申请已撤回。', 'success')
    } catch (error) {
      setOperationFailure(error)
      setOperationError(remoteErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (!state.session.user || !userId || !auth.session) {
    return <PageFrame title="作品更新" description="更新作品需要已认证的开发者管理权限。"><section className="submit-login-callout stack"><h2>请先登录</h2><Link className="button button--primary" to={`/auth?return_to=${encodeURIComponent(`${location.pathname}${location.search}`)}`}>登录并继续</Link></section></PageFrame>
  }
  if (loading) return <main className="page-container"><LoadingState label="作品更新权限加载中" /></main>
  if (loadError || !project) return <main className="page-container stack"><ErrorPanel message={loadError ?? '未找到作品'} /><div className="cluster"><Button variant="quiet" onClick={reload}>重新加载</Button><Link to="/projects">返回作品广场</Link></div></main>
  if (!access?.can_manage) {
    const verificationHref = access?.verification_id ? `/project/${project.id}/verify-author?verification_id=${encodeURIComponent(access.verification_id)}` : `/project/${project.id}/verify-author`
    const disputed = access?.developer?.verification_status === 'disputed'
    return <PageFrame title="没有此作品的更新权限" description={disputed ? '开发者归属存在争议，高风险编辑已冻结。' : '完成开发者身份认证后，才能提交作品更新。'}><div className="cluster"><Link className="button button--primary" to={verificationHref}>{disputed ? '查看归属争议状态' : access?.verification_id ? '查看认证进度' : '申请身份认证'}</Link><Link className="button" to="/about#corrections">提交公开纠错</Link><Link to={`/project/${project.id}`}>返回作品详情</Link></div></PageFrame>
  }

  if (unsupported) {
    return <PageFrame title={`${remoteTypeLabel(type)}暂不可用`} description="当前版本只支持版本说明、作品状态和产品说明更新。"><section className="feedback stack" role="status"><strong>{type === 'address' ? '公开地址更新暂不可用' : '复用资产更新暂不可用'}</strong><p>该操作需要额外的安全校验流程，完成前不会创建或提交更新草稿。</p><div className="cluster"><Link className="button button--primary" to={`/project/${project.id}/update?type=version`}>创建版本说明更新</Link><Link className="button" to={`/project/${project.id}`}>返回作品详情</Link></div></section></PageFrame>
  }

  if (remoteDraft && terminalRemoteStatuses.has(remoteDraft.status as 'applied' | 'rejected' | 'withdrawn')) {
    const terminalLabel = remoteDraft.status === 'applied' ? '上次更新已应用' : remoteDraft.status === 'rejected' ? '上次更新未通过' : '上次更新已撤回'
    return <PageFrame title={`更新 ${remoteProjectName(project)}`} description="上一条更新已经结束；如需继续修改，请显式创建新的更新草稿。"><section className="feedback stack" role="status"><strong>{terminalLabel}</strong><p>更新编号：<code>{remoteDraft.update_id}</code></p><p>公开作品只会在审核应用成功后变化。</p><div className="cluster"><Button variant="primary" disabled={creating} onClick={() => void startNewUpdate()}>{creating ? '创建中…' : '开始新的更新'}</Button><Link className="button" to={`/project/${project.id}`}>返回作品详情</Link></div>{operationError ? <p className="field-error" role="alert">{operationError}</p> : null}</section></PageFrame>
  }

  const canEditDraft = !remoteDraft || remoteDraft.status === 'editing' || remoteDraft.status === 'changes_requested' || remoteDraft.status === 'apply_failed'
  const pending = submitted || remoteDraft?.status === 'update_pending' || remoteDraft?.status === 'approved' || remoteDraft?.status === 'applying'
  return <PageFrame title={`更新 ${remoteProjectName(project)}`} description="提交后会进入审核队列；审核应用前，公开作品和时间线保持不变。">
    <div className="project-update-layout">
      <aside className="project-update-menu stack stack--small"><strong>选择更新内容</strong>{projectUpdateTypes.filter((item) => item !== 'asset' && item !== 'address').map((item) => <Button key={item} variant={item === type ? 'primary' : 'quiet'} aria-pressed={item === type} onClick={() => selectType(item)} disabled={busy || pending}>{remoteTypeLabel(item)}</Button>)}</aside>
      <section className="stack">
        <div className="wire-panel stack"><div className="cluster cluster--between"><h2>{remoteTypeLabel(type)}</h2><Tag>开发者管理权限</Tag></div>
          {type === 'version' ? <label className="field"><span className="field__label">版本说明</span><textarea className="input textarea" rows={4} value={value} onChange={(event) => setValue(event.target.value)} placeholder="例如：v1.2 发布，新增练习报告" disabled={!canEditDraft || busy} /></label> : null}
          {type === 'status' ? <><label className="field"><span className="field__label">新作品状态</span><select className="input" value={value} onChange={(event) => { setValue(event.target.value); setTerminalDeclared(false) }} disabled={!canEditDraft || busy}><option value="">请选择</option>{authorStatusOptions.map((status) => <option key={status} value={status}>{accessStatusText[status]}</option>)}</select></label>{value === 'paused' || value === 'ended' ? <label className="choice-card"><input type="checkbox" checked={terminalDeclared} onChange={(event) => setTerminalDeclared(event.target.checked)} disabled={!canEditDraft || busy} /><span>我明确声明该作品{value === 'paused' ? '暂停维护' : '已经结束'}；这不是由技术异常自动推断。</span></label> : null}</> : null}
          {type === 'description' ? <label className="field"><span className="field__label">新的一句话说明</span><textarea className="input textarea" rows={4} value={value} onChange={(event) => setValue(event.target.value)} disabled={!canEditDraft || busy} /></label> : null}
        </div>
        <section className="update-diff-preview stack"><div><h2>确认更新内容</h2></div><div className="update-diff-grid"><article><strong>更新前</strong><p>{displayValue(beforeValue)}</p></article><article><strong>更新后</strong><p>{afterPreview}</p></article></div><p>审核应用前，公开作品和时间线不会改变。</p></section>
        <section className="wire-panel stack"><h2>来源与影响范围</h2><label className="field"><span className="field__label">来源类型</span><select className="input" value={sourceType} onChange={(event) => setSourceType(event.target.value as ProjectUpdateInput['sourceType'])} disabled={!canEditDraft || busy}>{projectUpdateSourceTypes.map((item) => <option key={item} value={item}>{projectUpdateSourceLabels[item]}</option>)}</select></label><label className="field"><span className="field__label">来源说明</span><textarea className="input textarea" rows={3} value={sourceSummary} onChange={(event) => setSourceSummary(event.target.value)} placeholder="说明公开页面、仓库或开发者声明中的依据" disabled={!canEditDraft || busy} /></label><label className="field"><span className="field__label">影响范围</span><textarea className="input textarea" rows={3} value={impactScope} onChange={(event) => setImpactScope(event.target.value)} placeholder="说明详情、访问入口或使用者会受到什么影响" disabled={!canEditDraft || busy} /></label></section>
        {validation ? <p className="field-error" role="alert">{validation}</p> : null}
        {operationError ? <div className="stack"><ErrorPanel title="更新提交未完成" message={operationError} /><div className="cluster"><Button variant="quiet" onClick={reload}>重新加载</Button>{operationFailure instanceof ProjectUpdateApiError && (operationFailure.status === 403 || operationFailure.code.includes('AUTHORIZATION_REVOKED')) ? <Link className="button" to={`/project/${project.id}/verify-author`}>重新认证开发者身份</Link> : null}</div></div> : null}
        {pending ? <section className="feedback stack stack--small" role="status"><strong>更新已提交审核</strong><p>审核应用前，公开作品和时间线保持原样；审核通过后可刷新查看。</p><div className="cluster"><Button variant="quiet" onClick={() => void refreshSubmission()} disabled={busy}>{busy ? '读取中…' : '刷新审核状态'}</Button>{remoteDraft?.status === 'update_pending' ? <Button variant="quiet" onClick={() => void withdrawRemote()} disabled={busy}>撤回审核</Button> : null}<Link className="button button--primary" to={`/project/${project.id}`}>返回作品详情</Link></div></section> : null}
        {!pending ? <Button variant="primary" disabled={busy || !canEditDraft} onClick={requestSubmit}>{busy ? '提交中…' : '预览确认并提交更新'}</Button> : null}
      </section>
    </div>
    <ConfirmDialog open={confirming} title={`确认提交${remoteTypeLabel(type)}？`} description="提交后会进入审核队列，审核应用前不会改变公开作品。" confirmLabel="确认提交审核" onConfirm={() => void submitRemote()} onCancel={() => setConfirming(false)} />
  </PageFrame>
}

export function ProjectUpdatePage() {
  const forcedRemote = (globalThis as Record<string, unknown>).__VIBECHECK_REMOTE_PROJECT_UPDATES__ === true
  return forcedRemote || import.meta.env.PROD
    ? <RemoteProjectUpdatePage />
    : <LegacyProjectUpdatePage />
}
