import { useEffect, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { Button, ErrorPanel, LoadingState, PageFrame, Tag, useToast } from '../components'
import {
  authorManagementState,
  createVerificationRequest,
  latestVerificationFor,
  verificationMethodLabels,
  verificationStatusLabels,
} from '../features'
import { projectService, verificationService, type ServiceError, type ServiceScenarioId } from '../services'
import { createPrototypeEvent, useAppState } from '../state'
import { verificationMethods, type Project, type VerificationMethod } from '../types'

const fixedScenarios: ServiceScenarioId[] = ['default', 'review_changes_requested', 'review_approved', 'review_rejected', 'verification_disputed']

export function AuthorVerificationPage() {
  const { id } = useParams()
  const location = useLocation()
  const [params] = useSearchParams()
  const { state, dispatch } = useAppState()
  const { pushToast } = useToast()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ServiceError | null>(null)
  const [method, setMethod] = useState<VerificationMethod>('domain_control')
  const [summary, setSummary] = useState('')
  const [privateReference, setPrivateReference] = useState('')
  const [validation, setValidation] = useState<string | null>(null)
  const requestedScenario = params.get('scenario') as ServiceScenarioId | null
  const scenario = requestedScenario && fixedScenarios.includes(requestedScenario) ? requestedScenario : state.serviceScenario
  const request = project ? latestVerificationFor(state.verificationRequests, project.id, state.session.user?.id) : null
  const management = authorManagementState(request)

  useEffect(() => {
    let active = true
    setLoading(true)
    projectService.getById(id as Project['id'], { scenario: state.serviceScenario }).then((result) => {
      if (!active) return
      if (result.ok) { setProject(result.data); setError(null) }
      else setError(result.error)
      setLoading(false)
    })
    return () => { active = false }
  }, [id, state.serviceScenario])

  useEffect(() => {
    if (!request) return
    setMethod(request.method)
    setSummary(request.materialSummary)
    setPrivateReference(request.privateMaterialReference)
  }, [request])

  async function submit() {
    if (!project || !state.session.user || busy) return
    if (!summary.trim() || !privateReference.trim()) {
      setValidation('请同时填写材料摘要和仅供审核使用的材料引用。')
      return
    }
    setValidation(null)
    setBusy(true)
    const base = request
      ? { ...request, method, materialSummary: summary.trim(), privateMaterialReference: privateReference.trim() }
      : createVerificationRequest({ projectId: project.id, userId: state.session.user.id, method, materialSummary: summary, privateMaterialReference: privateReference })
    const result = await verificationService.submit(base, { scenario })
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    setError(null)
    dispatch({ type: 'VERIFICATION_UPSERT', request: result.data })
    dispatch({ type: 'EVENT_LOGGED', event: createPrototypeEvent(request ? 'author_verification_completed' : 'author_verification_started', { requestId: result.data.id, projectId: project.id, status: result.data.status }) })
    pushToast(result.data.status === 'verified' ? '作者身份已通过人工审核。' : '身份材料已提交并保存在私有审核区。', 'success')
  }

  async function refresh() {
    if (!request || busy) return
    setBusy(true)
    const result = await verificationService.submit(request, { scenario })
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    dispatch({ type: 'VERIFICATION_UPSERT', request: result.data })
    setError(null)
  }

  if (!state.session.user) {
    const from = encodeURIComponent(`${location.pathname}${location.search}`)
    return <PageFrame title="作者身份验证" description="这是低频的管理权限申请，不影响浏览作品。"><section className="submit-login-callout stack"><h2>请先登录后提交身份材料</h2><p>登录后会回到当前作品，材料不会公开展示。</p><Link className="button button--primary" to={`/auth?from=${from}`}>登录并继续</Link><Link to={`/project/${id}`}>先查看作品详情</Link></section></PageFrame>
  }
  if (loading) return <main className="page-container"><LoadingState label="身份验证页面加载中" /></main>
  if (error || !project) return <main className="page-container stack"><ErrorPanel message={error?.message ?? '未找到作品'} detail={error?.code} /><Link to="/projects">返回作品广场</Link></main>

  const projectName = project.currentName.state === 'known' ? project.currentName.value : '名称未知的作品'
  const canSubmit = !request || request.status === 'draft' || request.status === 'changes_requested' || request.status === 'failed'
  return (
    <PageFrame title="申请作者管理权限" description={`目标作品：${projectName}。身份验证只改变作者关联和编辑权限，不会创建或复制作品。`}>
      <div className="verification-layout">
        <section className="stack">
          <aside className="submission-guidance stack stack--small"><strong>人工审核与隐私边界</strong><p>这里不做自动身份验证。材料只保存在申请人与审核人员可见的审核区，不会进入作品详情、动态或作者公开主页。</p></aside>

          {canSubmit ? <section className="wire-panel stack" aria-labelledby="verification-material-heading">
            <div><p className="eyebrow">Private evidence</p><h2 id="verification-material-heading">选择一种主要证明方式</h2></div>
            <fieldset className="submission-choice-field"><legend>证明方式</legend><div className="verification-method-grid">{verificationMethods.map((value) => <label key={value} className="choice-card"><input type="radio" name="verification-method" value={value} checked={method === value} onChange={() => setMethod(value)} /><span><strong>{verificationMethodLabels[value]}</strong></span></label>)}</div></fieldset>
            <label className="field"><span className="field__label">材料摘要</span><textarea className="input textarea" rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="说明材料如何连接你的身份与该作品" /></label>
            <label className="field"><span className="field__label">私有材料引用</span><textarea className="input textarea" rows={3} value={privateReference} onChange={(event) => setPrivateReference(event.target.value)} placeholder="审核专用链接、仓库校验位置或材料编号" /></label>
            {validation ? <p className="field-error" role="alert">{validation}</p> : null}
            <Button variant="primary" disabled={busy} onClick={submit}>{request ? '更新材料并重新提交' : '提交人工审核'}</Button>
          </section> : null}

          {request ? <section className={`verification-status verification-status--${request.status} stack`} aria-live="polite">
            <div className="cluster cluster--between"><div><p className="eyebrow">Review status</p><h2>{verificationStatusLabels[request.status]}</h2></div><Tag tone={request.status === 'verified' ? 'strong' : 'dashed'}>{request.id}</Tag></div>
            {request.status === 'pending' ? <p>材料正在等待人工审核；没有可靠预计时间，因此不展示倒计时。</p> : null}
            {request.reviewMessage ? <p>{request.reviewMessage}</p> : null}
            {request.status === 'changes_requested' ? <p>上次提交的材料和审核意见均已保留，可在上方直接补充。</p> : null}
            {request.status === 'disputed' ? <aside className="trust-notice trust-notice--disputed"><strong>高风险编辑已冻结</strong><p>作品仍可公开查看，历史事实继续保留；归属解决前不能改写地址、状态和历史。</p></aside> : null}
            {request.status === 'verified' ? <div className="stack"><p>当前账号已关联此作品并获得作者编辑权限。验证没有新建作品，也没有删除任何历史。</p><div className="verification-next-grid">{[['product', '补充产品信息'], ['development', '补充开发信息'], ['version', '发布版本更新'], ['asset', '管理复用资产']].map(([type, label]) => <Link key={type} className="button" to={`/project/${project.id}/update?type=${type}`}>{label}</Link>)}</div></div> : null}
            {(request.status === 'pending' || request.status === 'changes_requested') ? <Button disabled={busy} onClick={refresh}>刷新人工审核状态</Button> : null}
          </section> : null}

          {request ? <details className="wire-panel verification-history"><summary>查看申请状态历史</summary><ol>{request.statusHistory.map((item, index) => <li key={`${item.status}-${index}`}><Tag>{verificationStatusLabels[item.status]}</Tag><time dateTime={item.happenedAt}>{new Date(item.happenedAt).toLocaleString('zh-CN')}</time>{item.message ? <p>{item.message}</p> : null}</li>)}</ol></details> : null}
        </section>
        <aside className="wire-panel stack verification-boundary"><h2>权限影响</h2><dl className="definition-list"><div><dt>作者关联</dt><dd>{management.linked ? '已关联' : '未关联'}</dd></div><div><dt>编辑权限</dt><dd>{management.canEdit ? '已开放' : '未开放'}</dd></div><div><dt>高风险编辑</dt><dd>{management.highRiskEditingFrozen ? '因争议冻结' : management.canEdit ? '按更新流程提交' : '不可用'}</dd></div><div><dt>作品数量</dt><dd>保持不变</dd></div></dl><Link to={`/project/${project.id}`}>返回作品详情</Link></aside>
      </div>
    </PageFrame>
  )
}
