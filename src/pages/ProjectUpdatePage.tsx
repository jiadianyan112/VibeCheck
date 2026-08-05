import { useEffect, useMemo, useState } from 'react'
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
import { projectService, projectUpdateService, type ServiceError } from '../services'
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
  source_code: '源代码', template: '模板', component: '组件', prompt: '提示词', parsing_solution: '解析方案', open_api: '开放 API', deployment_solution: '部署方案', other: '其他',
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

export function ProjectUpdatePage() {
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
    if (type === 'asset' && !assetName.trim()) return '请填写资产名称。'
    if (!sourceSummary.trim()) return '请说明更新来源。'
    if (!impactScope.trim()) return '请说明此次更新影响哪些公开内容。'
    if (type === 'address') { try { new URL(value) } catch { return '请输入完整的 http 或 https 地址。' } }
    if (type === 'status' && (value === 'paused' || value === 'ended') && !terminalDeclared) return '暂停或结束必须由作者明确勾选声明。'
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
    pushToast('更新已写入作品详情、生命周期时间线和公开动态。', 'success')
  }

  if (!state.session.user) {
    return <PageFrame title="作品更新" description="更新作品需要已验证的作者管理权限。"><section className="submit-login-callout stack"><h2>请先登录</h2><Link className="button button--primary" to={`/auth?from=${encodeURIComponent(`${location.pathname}${location.search}`)}`}>登录并继续</Link></section></PageFrame>
  }
  if (loading) return <main className="page-container"><LoadingState label="作品更新权限加载中" /></main>
  if (loadError || !project) return <main className="page-container stack"><ErrorPanel message={loadError?.message ?? '未找到作品'} detail={loadError?.code} /><Link to="/projects">返回作品广场</Link></main>
  if (!permission.allowed) return <PageFrame title="没有此作品的更新权限" description={permission.disputed ? '作者归属存在争议，高风险编辑已冻结。' : '身份验证只用于取得管理权限；普通纠错不要求声明作者身份。'}><div className="cluster"><Link className="button button--primary" to={`/project/${project.id}/verify-author`}>{permission.disputed ? '查看归属争议状态' : '申请作者身份验证'}</Link><Link className="button" to="/about#corrections">提交公开纠错</Link><Link to={`/project/${project.id}`}>返回作品详情</Link></div></PageFrame>

  const projectName = project.currentName.state === 'known' ? project.currentName.value : '名称未知的作品'
  const afterPreview = type === 'asset' ? `${assetName || '未命名资产'} · ${value || '未填写地址'}` : type === 'status' && value ? accessStatusText[value as AccessStatus] : value || '尚未填写'
  return (
    <PageFrame title={`更新 ${projectName}`} description="关键事实使用追加式生命周期事件；旧值与迁移、异常和公开历史不会被作者直接删除。">
      <div className="project-update-layout">
        <aside className="project-update-menu stack stack--small"><p className="eyebrow">Update type</p>{projectUpdateTypes.map((item) => <Button key={item} variant={item === type ? 'primary' : 'quiet'} aria-pressed={item === type} onClick={() => selectType(item)}>{projectUpdateTypeLabels[item]}</Button>)}</aside>
        <section className="stack">
          <div className="wire-panel stack"><div className="cluster cluster--between"><h2>{projectUpdateTypeLabels[type]}</h2><Tag>已验证作者</Tag></div>
            {type === 'version' ? <label className="field"><span className="field__label">新版本名称或编号</span><input className="input" value={value} onChange={(event) => setValue(event.target.value)} placeholder="例如 2.1 · 练习报告更新" /></label> : null}
            {type === 'address' ? <label className="field"><span className="field__label">新公开地址</span><input className="input" value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://" /></label> : null}
            {type === 'status' ? <><label className="field"><span className="field__label">新作品状态</span><select className="input" value={value} onChange={(event) => { setValue(event.target.value); setTerminalDeclared(false) }}><option value="">请选择</option>{authorStatusOptions.map((status) => <option key={status} value={status}>{accessStatusText[status]}</option>)}</select></label>{value === 'paused' || value === 'ended' ? <label className="choice-card"><input type="checkbox" checked={terminalDeclared} onChange={(event) => setTerminalDeclared(event.target.checked)} /><span>我明确声明该作品{value === 'paused' ? '暂停维护' : '已经结束'}；这不是由技术异常自动推断。</span></label> : null}</> : null}
            {type === 'description' ? <label className="field"><span className="field__label">新的一句话说明</span><textarea className="input textarea" rows={4} value={value} onChange={(event) => setValue(event.target.value)} /></label> : null}
            {type === 'asset' ? <div className="stack"><label className="field"><span className="field__label">资产名称</span><input className="input" value={assetName} onChange={(event) => setAssetName(event.target.value)} /></label><label className="field"><span className="field__label">资产类型</span><select className="input" value={assetType} onChange={(event) => setAssetType(event.target.value as AssetType)}>{assetTypes.map((item) => <option key={item} value={item}>{assetTypeLabels[item]}</option>)}</select></label><label className="field"><span className="field__label">资产公开地址</span><input className="input" value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://" /></label><label className="field"><span className="field__label">许可证（可选）</span><input className="input" value={assetLicense} onChange={(event) => setAssetLicense(event.target.value)} /></label></div> : null}
          </div>

          <section className="update-diff-preview stack"><div><p className="eyebrow">Before / after</p><h2>提交前值与后值预览</h2></div><div className="update-diff-grid"><article><strong>更新前</strong><p>{displayValue(beforeValue)}</p></article><article><strong>更新后</strong><p>{afterPreview}</p></article></div><p>影响字段：<code>{type}</code>。提交后旧值保留在事件 changes 中。</p></section>

          <section className="wire-panel stack"><h2>来源与影响范围</h2><label className="field"><span className="field__label">来源类型</span><select className="input" value={sourceType} onChange={(event) => setSourceType(event.target.value as ProjectUpdateInput['sourceType'])}>{projectUpdateSourceTypes.map((item) => <option key={item} value={item}>{projectUpdateSourceLabels[item]}</option>)}</select></label><label className="field"><span className="field__label">来源说明</span><textarea className="input textarea" rows={3} value={sourceSummary} onChange={(event) => setSourceSummary(event.target.value)} placeholder="说明公开页面、仓库或作者声明中的依据" /></label><label className="field"><span className="field__label">影响范围</span><textarea className="input textarea" rows={3} value={impactScope} onChange={(event) => setImpactScope(event.target.value)} placeholder="说明详情、访问入口、使用者或复用方会受到什么影响" /></label></section>
          {validation ? <p className="field-error" role="alert">{validation}</p> : null}
          {operationError ? <div className="stack"><ErrorPanel title="更新提交未完成" message={operationError.message} detail={operationError.code} onRetry={operationError.retryable ? submit : undefined} />{operationError.code === 'VC_UPDATE_PERMISSION_EXPIRED' ? <Link className="button" to={`/project/${project.id}/verify-author`}>重新验证作者权限</Link> : null}</div> : null}
          {completedEventId ? <section className="feedback stack stack--small" role="status"><strong>更新已追加写入</strong><p>详情时间线和公开动态使用同一事件 ID；关注者通知已按关注关系生成。</p><div className="cluster"><Link className="button button--primary" to={`/project/${project.id}#${completedEventId}`}>在详情中查看</Link><Link className="button" to={`/activity#${completedEventId}`}>在动态中查看</Link></div></section> : null}
          <Button variant="primary" disabled={busy || Boolean(completedEventId)} onClick={requestSubmit}>{busy ? '提交中…' : completedEventId ? '本次更新已提交' : '预览确认并提交更新'}</Button>
        </section>
      </div>
      <ConfirmDialog open={confirming} title={`确认提交${projectUpdateTypeLabels[type]}？`} description="更新会追加一条不可直接删除的公开生命周期事件，并同步详情、动态和关注者通知。" confirmLabel="确认提交更新" onConfirm={() => void submit()} onCancel={() => setConfirming(false)} />
    </PageFrame>
  )
}
