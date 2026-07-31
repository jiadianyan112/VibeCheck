import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Input, PageFrame, useToast } from '../components'
import { canContinueAfterUrlCheck, createUrlCheckDraft, duplicateDetailPath, duplicateVerificationPath, getDuplicateProjectSummary, urlCheckLabels } from '../features'
import {
  normalizeSubmissionUrl,
  serviceScenarioIds,
  submissionService,
  type ServiceScenarioId,
  type UrlCheckItem,
  type UrlCheckResult,
} from '../services'
import { useAppState } from '../state'

const checkOrder: UrlCheckItem['key'][] = [
  'format',
  'safety',
  'access',
  'duplicate',
  'category',
]

function validateUrl(value: string) {
  if (!value.trim()) return '请输入作品的公开访问地址。'
  try {
    normalizeSubmissionUrl(value.trim())
    return ''
  } catch {
    return '请输入可识别的 HTTP 或 HTTPS 公开 URL。'
  }
}

function scenarioFromQuery(value: string | null): ServiceScenarioId | null {
  return serviceScenarioIds.find((scenario) => scenario === value) ?? null
}

export function SubmitEntryPage() {
  const { state, dispatch } = useAppState()
  const { pushToast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryScenario = scenarioFromQuery(searchParams.get('scenario'))
  const scenario = queryScenario ?? state.serviceScenario
  const [url, setUrl] = useState(() => searchParams.get('resumeUrl') ?? '')
  const [touched, setTouched] = useState(false)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<UrlCheckResult | null>(null)
  const [requestError, setRequestError] = useState('')
  const [cancelled, setCancelled] = useState(false)
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null)
  const [declaredAuthor, setDeclaredAuthor] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const validationError = touched ? validateUrl(url) : ''

  useEffect(() => () => controllerRef.current?.abort(), [])

  const checkByKey = useMemo(
    () => new Map(result?.checks.map((check) => [check.key, check]) ?? []),
    [result],
  )

  if (!state.session.user) {
    return (
      <PageFrame
        title="发布作品"
        description="发布前需要选择一个固定测试身份，登录后会自动返回这里。"
      >
        <section className="submit-login-callout stack stack--small">
          <h2>先登录，再检查作品地址</h2>
          <p>当前输入步骤不会在访客身份下创建草稿。</p>
          <Link className="button button--primary" to="/auth?from=%2Fsubmit">
            登录后发布
          </Link>
        </section>
      </PageFrame>
    )
  }

  const checkUrl = async (event?: FormEvent) => {
    event?.preventDefault()
    setTouched(true)
    const error = validateUrl(url)
    if (error || checking) return

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setChecking(true)
    setResult(null)
    setRequestError('')
    setCancelled(false)
    setSavedDraftId(null)
    setDeclaredAuthor(false)

    const response = await submissionService.checkUrl(url, {
      scenario,
      signal: controller.signal,
    })
    if (controllerRef.current !== controller) return
    setChecking(false)
    if (!response.ok) {
      if (response.error.kind === 'aborted') {
        setCancelled(true)
        return
      }
      setRequestError(response.error.message)
      return
    }
    setUrl(response.data.normalizedUrl)
    setResult(response.data)
    if (response.data.duplicateProjectId) {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.set('resumeUrl', response.data.normalizedUrl)
      nextParams.set('scenario', scenario)
      setSearchParams(nextParams, { replace: true })
    }
  }

  const cancelCheck = () => {
    controllerRef.current?.abort()
  }

  const saveDraft = () => {
    if (!result?.canCreateDraft || !state.session.user) return
    const draft = createUrlCheckDraft(result, state.session.user.id)
    dispatch({ type: 'DRAFT_UPSERT', draft })
    setSavedDraftId(draft.id)
    pushToast('地址检查草稿已保存。', 'success')
  }

  const allPassed = result ? canContinueAfterUrlCheck(result) : false
  const duplicateSummary = result?.duplicateProjectId
    ? getDuplicateProjectSummary(result.duplicateProjectId)
    : null

  return (
    <PageFrame
      title="先检查作品地址"
      description="补全协议并依次模拟格式、安全、访问、查重和品类检查。当前任务只完成这个入口步骤。"
    >
      <div className="submission-entry-layout">
        <form className="submission-url-panel stack" onSubmit={checkUrl} noValidate>
          <div className="stack stack--small">
            <p className="eyebrow">P10 · 地址检查</p>
            <h2>公开访问 URL</h2>
          </div>
          <Input
            label="作品地址"
            hint="可省略 https://；例如 example.test/my-learning-tool"
            error={validationError}
            value={url}
            inputMode="url"
            autoComplete="url"
            onChange={(event) => {
              setUrl(event.target.value)
              setTouched(true)
              setResult(null)
              setSavedDraftId(null)
            }}
            onBlur={() => {
              setTouched(true)
              if (!validateUrl(url)) setUrl(normalizeSubmissionUrl(url.trim()))
            }}
          />
          <div className="cluster">
            <Button variant="primary" type="submit" loading={checking} disabled={Boolean(validationError)}>
              检查地址
            </Button>
            {checking ? <Button type="button" onClick={cancelCheck}>取消检查</Button> : null}
          </div>
          <p className="submission-scenario-note">
            固定模拟场景：<strong>{scenario}</strong>
            {queryScenario ? '（由当前地址参数锁定）' : '（可在原型调试面板切换）'}
          </p>
          {requestError ? <div className="feedback feedback--error" role="alert"><strong>检查未完成</strong><p>{requestError}</p></div> : null}
          {cancelled ? <div className="feedback" role="status"><strong>检查已取消</strong><p>没有创建草稿，也没有发出重复检查。</p></div> : null}
        </form>

        <section className="url-check-panel stack" aria-labelledby="url-check-heading" aria-busy={checking || undefined}>
          <div className="stack stack--small">
            <h2 id="url-check-heading">检查进度</h2>
            <p>每一项都保留独立结果，不用一个“成功”掩盖风险。</p>
          </div>
          <ol className="url-check-list">
            {checkOrder.map((key) => {
              const item = checkByKey.get(key)
              const status = checking ? 'checking' : item?.status ?? 'idle'
              return (
                <li key={key} className={`url-check-item url-check-item--${status}`}>
                  <span aria-hidden="true">{checking ? '…' : item?.status === 'passed' ? '✓' : item?.status === 'warning' ? '!' : item?.status === 'failed' ? '×' : '○'}</span>
                  <div>
                    <strong>{urlCheckLabels[key]}</strong>
                    <p>{checking ? '等待检查结果…' : item?.message ?? '尚未检查'}</p>
                  </div>
                </li>
              )
            })}
          </ol>

          {duplicateSummary && result ? (
            <section className="duplicate-branch stack" aria-labelledby="duplicate-heading">
              <div className="stack stack--small">
                <p className="eyebrow">发现已有档案</p>
                <h3 id="duplicate-heading">{duplicateSummary.name}</h3>
                <p>默认不新建作品；请先核对已有档案。</p>
              </div>
              <dl className="duplicate-summary">
                <div><dt>已有地址</dt><dd>{duplicateSummary.publicUrl}</dd></div>
                <div><dt>作者关联</dt><dd>{duplicateSummary.authorLinkLabel}</dd></div>
                <div><dt>档案来源</dt><dd>{duplicateSummary.sourceLabel}</dd></div>
              </dl>
              <Link
                className="button button--primary"
                to={duplicateDetailPath(duplicateSummary.id, result.normalizedUrl, scenario)}
              >
                查看已有作品详情
              </Link>
              <label className="choice-card duplicate-author-choice">
                <input
                  type="checkbox"
                  checked={declaredAuthor}
                  onChange={(event) => setDeclaredAuthor(event.target.checked)}
                />
                <span><strong>我是该作品作者，并需要管理档案</strong><small>仅在你需要管理已有档案时继续身份验证。</small></span>
              </label>
              {declaredAuthor ? (
                <Link
                  className="weak-link"
                  to={duplicateVerificationPath(duplicateSummary.id, result.normalizedUrl, scenario)}
                >
                  继续验证作者身份
                </Link>
              ) : null}
              <details className="duplicate-dispute-placeholder">
                <summary>这不是同一个作品</summary>
                <p>可在后续入口提交名称、地址或功能差异证据；平台核验前仍不会默认新建档案。</p>
                <Button type="button" disabled>提交“非同一作品”证据（占位）</Button>
              </details>
            </section>
          ) : result ? (
            <div className="url-check-outcome stack stack--small" role="status">
              <strong>{allPassed ? '地址检查通过' : result.canCreateDraft ? '检查未完全通过，可先保存草稿' : '当前地址不能创建发布草稿'}</strong>
              <div className="cluster">
                {result.canCreateDraft ? <Button type="button" onClick={saveDraft}>{savedDraftId ? '草稿已保存' : '保存地址草稿'}</Button> : null}
                {!allPassed ? <Button type="button" variant="primary" disabled>继续发布</Button> : null}
              </div>
              {savedDraftId ? <p>草稿编号：<code>{savedDraftId}</code>。重复保存会更新同一条草稿。</p> : null}
              {allPassed ? <p>下一任务 T37 将根据查重结果接入后续分流；此处不提前创建分支页。</p> : null}
            </div>
          ) : null}
        </section>
      </div>
    </PageFrame>
  )
}
