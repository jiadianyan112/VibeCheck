import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button, EmptyState, Tag } from '../components'
import {
  adminProjectDraftFrom,
  authorLinkStatusLabels,
  mergeAdminProjects,
  reviewStatusLabels,
  saveAdminProjectDraft,
  type AdminProjectDraft,
  type AdminProjectDraftErrors,
} from '../features'
import { projects } from '../mocks'
import { useAppState } from '../state'
import {
  feedbackMethods,
  inputTypes,
  outputTypes,
  practiceFormats,
  targetUsers,
  useScenarios,
  type FieldFact,
  type Project,
} from '../types'
import {
  feedbackMethodLabels,
  inputTypeLabels,
  outputTypeLabels,
  practiceFormatLabels,
  scenarioLabels,
  targetUserLabels,
  accessStatusText,
} from '../utils'

const recordSourceLabels: Record<Project['recordSource'], string> = {
  platform_editor: '平台编辑收录', public_discovery: '公开发现', author_submission: '作者提交', user_submission: '用户提交',
}
const confidenceLabels = { high: '高可信', medium: '中可信', low: '低可信' } as const
const sectionErrorKeys: Record<string, Array<keyof AdminProjectDraft>> = {
  identity: ['currentName', 'originalPlatform'],
  definition: ['oneLineDefinition', 'coreProblem', 'targetUsers', 'useScenarios'],
  solution: ['mainInputs', 'mainOutputs', 'practiceFormats', 'feedbackMethods', 'differentiation'],
  features: ['coreFeatures', 'secondaryFeatures'],
  development: ['techStack', 'modelsUsed', 'deploymentPlatform', 'developmentCycle'],
}

function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '未记录'
}

function FieldShell({ label, fact, source, permission, error, children }: { label: string; fact: FieldFact<unknown>; source: string; permission: string; error?: string; children: ReactNode }) {
  return (
    <article className={`admin-field ${error ? 'admin-field--error' : ''}`}>
      <div className="admin-field__heading"><strong>{label}</strong><Tag tone={permission.includes('只读') || permission.includes('仅管理员') ? 'dashed' : 'default'}>{permission}</Tag></div>
      <div>{children}</div>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      <dl className="admin-field__meta"><div><dt>来源</dt><dd>{source} · {fact.evidenceIds.length} 条证据引用</dd></div><div><dt>验证时间</dt><dd>{dateLabel(fact.lastVerifiedAt)}</dd></div><div><dt>可信类型</dt><dd>{fact.confidence ? confidenceLabels[fact.confidence] : '未单独评级'} · {fact.freshness}</dd></div><div><dt>争议</dt><dd>{fact.disputeStatus === 'none' ? '无争议标记' : fact.disputeStatus}</dd></div></dl>
    </article>
  )
}

function MultiChoice<T extends string>({ values, selected, labels, onChange, disabled }: { values: readonly T[]; selected: readonly T[]; labels: Record<T, string>; onChange: (value: T[]) => void; disabled?: boolean }) {
  return <div className="admin-choice-grid">{values.map((value) => <label className="choice-card" key={value}><input type="checkbox" disabled={disabled} checked={selected.includes(value)} onChange={(event) => onChange(event.target.checked ? [...selected, value] : selected.filter((item) => item !== value))} /><span>{labels[value]}</span></label>)}</div>
}

export function AdminProjectEditorPage() {
  const { id } = useParams()
  const { state, dispatch } = useAppState()
  const allProjects = useMemo(() => mergeAdminProjects(projects, state.projectOverrides), [state.projectOverrides])
  const project = allProjects.find((item) => item.id === id) ?? null
  const [draft, setDraft] = useState<AdminProjectDraft | null>(() => project ? adminProjectDraftFrom(project) : null)
  const [errors, setErrors] = useState<AdminProjectDraftErrors>({})
  const [saved, setSaved] = useState(false)
  const isAdministrator = state.session.role === 'admin'

  useEffect(() => {
    if (project) setDraft(adminProjectDraftFrom(project))
  }, [project])

  if (!project || !draft) return <div className="admin-page stack"><EmptyState title="后台未找到对应作品" description="该稳定 ID 不存在，或作品尚未进入当前原型数据集。" action={<Link className="button" to="/admin/projects">返回作品列表</Link>} /></div>

  const source = recordSourceLabels[project.recordSource]
  function update<K extends keyof AdminProjectDraft>(key: K, value: AdminProjectDraft[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current)
    setErrors((current) => ({ ...current, [key]: undefined }))
    setSaved(false)
  }
  function sectionHasError(section: keyof typeof sectionErrorKeys) {
    return sectionErrorKeys[section]?.some((key) => errors[key]) ?? false
  }
  function save() {
    const result = saveAdminProjectDraft(project!, draft!, isAdministrator)
    setErrors(result.errors)
    if (!result.project) {
      setSaved(false)
      document.querySelector('.admin-field--error input, .admin-field--error textarea')?.scrollIntoView({ block: 'center' })
      return
    }
    dispatch({ type: 'ADMIN_PROJECT_SAVE', project: result.project })
    setSaved(true)
  }

  const projectName = project.currentName.state === 'known' ? project.currentName.value : '名称未知'
  const currentUrl = project.publicUrl.state === 'known' ? project.publicUrl.value : `未知：${project.publicUrl.reason}`
  const currentStatus = project.accessStatus.state === 'known' ? accessStatusText[project.accessStatus.value] : `未知：${project.accessStatus.reason}`
  return (
    <div className="admin-page stack">
      <header className="admin-editor-summary"><div><p className="eyebrow">A03 · Stable record</p><h1>编辑 {projectName}</h1><code>{project.id}</code></div><div className="cluster"><Tag>{reviewStatusLabels[project.reviewStatus]}</Tag><Tag tone="dashed">{authorLinkStatusLabels[project.authorLinkStatus]}</Tag><Link className="button" to={`/project/${project.id}`}>查看前台</Link></div></header>

      <div className="admin-editor-layout">
        <nav className="admin-module-nav" aria-label="作品编辑模块">
          <a href="#identity">身份{sectionHasError('identity') ? ' · 有错误' : ''}</a><a href="#definition">定义{sectionHasError('definition') ? ' · 有错误' : ''}</a><a href="#solution">方案{sectionHasError('solution') ? ' · 有错误' : ''}</a><a href="#features">功能{sectionHasError('features') ? ' · 有错误' : ''}</a><a href="#development">开发{sectionHasError('development') ? ' · 有错误' : ''}</a><a href="#status">状态</a><a href="#history">历史</a><a href="#assets">资产</a><a href="#relations">关系</a>
        </nav>
        <div className="admin-editor-main stack">
          <section id="identity" className="admin-editor-section stack"><div><p className="eyebrow">Identity</p><h2>作品身份</h2></div><FieldShell label="当前名称" fact={project.currentName} source={source} permission="编辑与管理员可编辑" error={errors.currentName}><input className="input" aria-label="当前名称" value={draft.currentName} onChange={(event) => update('currentName', event.target.value)} /></FieldShell><FieldShell label="原始收录平台" fact={project.originalPlatform} source={source} permission={isAdministrator ? '管理员可编辑' : '仅管理员可编辑'} error={errors.originalPlatform}><input className="input" aria-label="原始收录平台" disabled={!isAdministrator} value={draft.originalPlatform} onChange={(event) => update('originalPlatform', event.target.value)} /></FieldShell><FieldShell label="当前公开地址" fact={project.publicUrl} source={source} permission="只读 · 迁移流程"><div className="admin-protected-value"><code>{currentUrl}</code><Link to="/admin/status-monitor">通过状态复核处理地址迁移</Link></div></FieldShell></section>

          <section id="definition" className="admin-editor-section stack"><div><p className="eyebrow">Definition</p><h2>定义与人群</h2></div><FieldShell label="一句话定义" fact={project.oneLineDefinition} source={source} permission="编辑与管理员可编辑" error={errors.oneLineDefinition}><textarea className="input textarea" aria-label="一句话定义" rows={3} value={draft.oneLineDefinition} onChange={(event) => update('oneLineDefinition', event.target.value)} /></FieldShell><FieldShell label="核心问题" fact={project.coreProblem} source={source} permission="编辑与管理员可编辑" error={errors.coreProblem}><textarea className="input textarea" aria-label="核心问题" rows={3} value={draft.coreProblem} onChange={(event) => update('coreProblem', event.target.value)} /></FieldShell><FieldShell label="目标用户" fact={project.targetUsers} source={source} permission="编辑与管理员可编辑" error={errors.targetUsers}><MultiChoice values={targetUsers} selected={draft.targetUsers} labels={targetUserLabels} onChange={(value) => update('targetUsers', value)} /></FieldShell><FieldShell label="使用场景" fact={project.useScenarios} source={source} permission="编辑与管理员可编辑" error={errors.useScenarios}><MultiChoice values={useScenarios} selected={draft.useScenarios} labels={scenarioLabels} onChange={(value) => update('useScenarios', value)} /></FieldShell></section>

          <section id="solution" className="admin-editor-section stack"><div><p className="eyebrow">Solution</p><h2>方案结构</h2></div><FieldShell label="主要输入" fact={project.mainInputs} source={source} permission="编辑与管理员可编辑" error={errors.mainInputs}><MultiChoice values={inputTypes} selected={draft.mainInputs} labels={inputTypeLabels} onChange={(value) => update('mainInputs', value)} /></FieldShell><FieldShell label="主要输出" fact={project.mainOutputs} source={source} permission="编辑与管理员可编辑" error={errors.mainOutputs}><MultiChoice values={outputTypes} selected={draft.mainOutputs} labels={outputTypeLabels} onChange={(value) => update('mainOutputs', value)} /></FieldShell><FieldShell label="练习形式" fact={project.practiceFormats} source={source} permission="编辑与管理员可编辑" error={errors.practiceFormats}><MultiChoice values={practiceFormats} selected={draft.practiceFormats} labels={practiceFormatLabels} onChange={(value) => update('practiceFormats', value)} /></FieldShell><FieldShell label="反馈方式" fact={project.feedbackMethods} source={source} permission="编辑与管理员可编辑" error={errors.feedbackMethods}><MultiChoice values={feedbackMethods} selected={draft.feedbackMethods} labels={feedbackMethodLabels} onChange={(value) => update('feedbackMethods', value)} /></FieldShell><FieldShell label="差异化说明" fact={project.differentiation} source={source} permission="编辑与管理员可编辑" error={errors.differentiation}><textarea className="input textarea" aria-label="差异化说明" rows={3} value={draft.differentiation} onChange={(event) => update('differentiation', event.target.value)} /></FieldShell><FieldShell label="核心流程" fact={project.coreFlow} source={source} permission="只读 · 结构化流程"><ol>{project.coreFlow.state === 'known' ? project.coreFlow.value.map((node) => <li key={node.id}>{node.order}. {node.label}：{node.description}</li>) : <li>{project.coreFlow.reason}</li>}</ol></FieldShell></section>

          <section id="features" className="admin-editor-section stack"><div><p className="eyebrow">Features</p><h2>功能</h2></div><FieldShell label="核心功能" fact={project.coreFeatures} source={source} permission="编辑与管理员可编辑" error={errors.coreFeatures}><textarea className="input textarea" aria-label="核心功能" rows={4} value={draft.coreFeatures} onChange={(event) => update('coreFeatures', event.target.value)} /><small>每行一项。</small></FieldShell><FieldShell label="次要功能" fact={project.secondaryFeatures} source={source} permission="编辑与管理员可编辑" error={errors.secondaryFeatures}><textarea className="input textarea" aria-label="次要功能" rows={4} value={draft.secondaryFeatures} onChange={(event) => update('secondaryFeatures', event.target.value)} /><small>每行一项。</small></FieldShell></section>

          <section id="development" className="admin-editor-section stack"><div><p className="eyebrow">Development</p><h2>开发信息</h2></div><FieldShell label="技术栈" fact={project.techStack} source={source} permission="编辑与管理员可编辑" error={errors.techStack}><textarea className="input textarea" aria-label="技术栈" rows={4} value={draft.techStack} onChange={(event) => update('techStack', event.target.value)} /></FieldShell><FieldShell label="使用模型" fact={project.modelsUsed} source={source} permission="编辑与管理员可编辑" error={errors.modelsUsed}><textarea className="input textarea" aria-label="使用模型" rows={4} value={draft.modelsUsed} onChange={(event) => update('modelsUsed', event.target.value)} /></FieldShell><FieldShell label="部署平台" fact={project.deploymentPlatform} source={source} permission="编辑与管理员可编辑" error={errors.deploymentPlatform}><input className="input" aria-label="部署平台" value={draft.deploymentPlatform} onChange={(event) => update('deploymentPlatform', event.target.value)} /></FieldShell><FieldShell label="开发周期" fact={project.developmentCycle} source={source} permission="编辑与管理员可编辑" error={errors.developmentCycle}><input className="input" aria-label="开发周期" value={draft.developmentCycle} onChange={(event) => update('developmentCycle', event.target.value)} /></FieldShell></section>

          <section id="status" className="admin-editor-section stack"><div><p className="eyebrow">Protected status</p><h2>当前状态与权限边界</h2></div><div className="admin-protected-grid"><article><strong>访问状态</strong><p>{currentStatus}</p><Tag tone="dashed">只读 · 必须留痕</Tag></article><article><strong>发布状态</strong><p>{reviewStatusLabels[project.reviewStatus]}</p><Tag tone="dashed">只读 · 审核动作</Tag></article><article><strong>作者关联</strong><p>{authorLinkStatusLabels[project.authorLinkStatus]}</p><Tag tone="dashed">只读 · 身份审核</Tag></article><article><strong>完整度</strong><p>{project.completenessLevel}</p><Tag tone="dashed">只读 · 由字段推导</Tag></article></div><p>迁移、暂停、结束、限制展示和归属争议不能在普通保存中被覆盖；请进入对应工作队列并填写操作原因。</p><div className="cluster"><Link className="button" to="/admin/status-monitor">进入状态监测</Link><Link className="button" to="/admin/reviews">进入发布审核</Link><Link className="button" to="/admin/author-verification">进入身份审核</Link></div></section>

          <section id="history" className="admin-editor-section stack"><div><p className="eyebrow">Append-only</p><h2>历史</h2></div><p>历史地址 {project.historicalUrls.length} 条、历史名称 {project.historicalNames.length} 条、生命周期事件 {project.eventIds.length} 条。普通编辑不可删除或覆盖。</p>{project.historicalUrls.length ? <ul>{project.historicalUrls.map((item) => <li key={item.url}><code>{item.url}</code> · {item.effectiveFrom}—{item.effectiveTo ?? '当前记录'}</li>)}</ul> : <span>暂无历史地址。</span>}</section>
          <section id="assets" className="admin-editor-section stack"><div><p className="eyebrow">Assets</p><h2>资产</h2></div><p>当前关联 {project.assetIds.length} 项资产；T48 仅显示引用，不在此无痕改写资产记录。</p><Link to={`/project/${project.id}#assets`}>在前台查看资产与可用性</Link></section>
          <section id="relations" className="admin-editor-section stack"><div><p className="eyebrow">Relations</p><h2>关系</h2></div><p>当前关联 {project.relationIds.length} 条作品关系；确认状态和争议由专用流程维护。</p><Link to={`/project/${project.id}#relations`}>在前台查看关系</Link></section>

          {saved ? <div className="feedback" role="status"><strong>作品字段已保存并同步前台。</strong><p>受保护状态、历史、资产和关系未被普通保存修改。</p></div> : null}
          {Object.keys(errors).length ? <div className="feedback feedback--error" role="alert"><strong>部分字段未保存</strong><p>请按模块导航中的错误提示修正后重试。</p></div> : null}
          <div className="admin-editor-actions"><Button variant="primary" onClick={save}>保存允许字段</Button><Button variant="quiet" onClick={() => { setDraft(adminProjectDraftFrom(project)); setErrors({}); setSaved(false) }}>撤销未保存修改</Button><Link to="/admin/projects">返回作品列表</Link></div>
        </div>
      </div>
    </div>
  )
}
