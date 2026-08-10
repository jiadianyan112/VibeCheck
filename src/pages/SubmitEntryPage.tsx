import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, ErrorPanel, Input, PageFrame, useToast } from '../components'
import { canContinueAfterUrlCheck, createUrlCheckDraft, duplicateDetailPath, duplicateVerificationPath, getDuplicateProjectSummary, urlCheckLabels } from '../features'
import { resolveServiceScenario } from '../mocks'
import {
  normalizeSubmissionUrl,
  submissionService,
  type ServiceError,
  type UrlCheckItem,
  type UrlCheckResult,
} from '../services'
import { useAppState } from '../state'
import type { ProjectCategoryId } from '../types'

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

export function SubmitEntryPage() {
  const { state, dispatch } = useAppState()
  const { pushToast } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const scenario = resolveServiceScenario(searchParams, state.serviceScenario)
  const [url, setUrl] = useState(() => searchParams.get('resumeUrl') ?? state.submissionEntryValue)
  const [categoryId, setCategoryId] = useState<ProjectCategoryId>(() => {
    const requestedCategory = searchParams.get('category')
    return requestedCategory === 'personal_site_portfolio' || requestedCategory === 'ai_learning_quiz'
      ? requestedCategory
      : state.submissionEntryCategoryId
  })
  const [touched, setTouched] = useState(false)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<UrlCheckResult | null>(null)
  const [requestError, setRequestError] = useState<ServiceError | null>(null)
  const [cancelled, setCancelled] = useState(false)
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null)
  const [declaredAuthor, setDeclaredAuthor] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const autoCheckKeyRef = useRef('')
  const validationError = touched ? validateUrl(url) : ''

  useEffect(() => () => controllerRef.current?.abort(), [])

  useEffect(() => {
    if (state.submissionEntryCategoryId !== categoryId) dispatch({ type: 'SUBMISSION_ENTRY_CATEGORY_SET', categoryId })
  }, [categoryId, dispatch, state.submissionEntryCategoryId])

  const checkUrl = useCallback(async (event?: FormEvent) => {
    event?.preventDefault()
    setTouched(true)
    const error = validateUrl(url)
    if (error || checking) return

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setChecking(true)
    setResult(null)
    setRequestError(null)
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
      setRequestError(response.error)
      return
    }
    setUrl(response.data.normalizedUrl)
    dispatch({ type: 'SUBMISSION_ENTRY_VALUE_SET', value: response.data.normalizedUrl })
    setResult(response.data)
    if (response.data.duplicateProjectId) {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.set('resumeUrl', response.data.normalizedUrl)
      nextParams.set('scenario', scenario)
      setSearchParams(nextParams, { replace: true })
    }
  }, [checking, dispatch, scenario, searchParams, setSearchParams, url])

  useEffect(() => {
    if (!state.session.user || searchParams.get('autoCheck') !== '1') return
    const autoCheckKey = `${scenario}:${searchParams.get('resumeUrl') ?? ''}`
    if (autoCheckKeyRef.current === autoCheckKey) return
    autoCheckKeyRef.current = autoCheckKey
    void checkUrl()
  }, [checkUrl, scenario, searchParams, state.session.user])

  const checkByKey = useMemo(
    () => new Map(result?.checks.map((check) => [check.key, check]) ?? []),
    [result],
  )

  const cancelCheck = () => {
    controllerRef.current?.abort()
  }

  const saveDraft = () => {
    if (!result?.canCreateDraft || !state.session.user) return
    const draft = createUrlCheckDraft(result, state.session.user.id, undefined, categoryId)
    dispatch({ type: 'DRAFT_UPSERT', draft })
    setSavedDraftId(draft.id)
    pushToast('地址检查草稿已保存。', 'success')
  }

  const continueNewSubmission = () => {
    if (!result || !allPassed || !state.session.user) return
    const draft = { ...createUrlCheckDraft(result, state.session.user.id, undefined, categoryId), step: 'prefill' as const }
    dispatch({ type: 'DRAFT_UPSERT', draft })
    navigate(`/submit/new?${new URLSearchParams({ draft: draft.id, step: 'prefill' })}`)
  }

  const allPassed = result ? canContinueAfterUrlCheck(result) : false
  const duplicateSummary = result?.duplicateProjectId
    ? getDuplicateProjectSummary(result.duplicateProjectId)
    : null

  if (!state.session.user) {
    const returnPath = encodeURIComponent(`${location.pathname}${location.search}`)
    return (
      <PageFrame
        title="发布作品"
        description="登录后可以保存草稿，并在提交后查看审核进度。"
      >
        <section className="submit-login-callout stack stack--small">
          <h2>先登录，再检查作品地址</h2>
          <p>登录后会回到这里，刚才的作品地址不会丢失。</p>
          <Link className="button button--primary" to={`/auth?return_to=${returnPath}`}>
            登录后发布
          </Link>
        </section>
      </PageFrame>
    )
  }

  return (
    <PageFrame
      title="先检查作品地址"
      description="输入作品的公开访问地址，我们会先检查链接是否可用，以及社区里是否已有档案。"
    >
      <div className="submission-entry-layout">
        <form className="submission-url-panel stack" onSubmit={checkUrl} noValidate>
          <div className="stack stack--small">
            <h2>公开访问 URL</h2>
          </div>
          <label className="field"><span className="field__label">作品品类</span><select className="input" value={categoryId} onChange={(event) => { const nextCategoryId = event.target.value as ProjectCategoryId; setCategoryId(nextCategoryId); dispatch({ type: 'SUBMISSION_ENTRY_CATEGORY_SET', categoryId: nextCategoryId }); setResult(null); setSavedDraftId(null) }}><option value="ai_learning_quiz">AI 学习与题库</option><option value="personal_site_portfolio">个人主页与作品集</option></select><small>{categoryId === 'personal_site_portfolio' ? '需为无需登录即可查看主要内容、围绕明确个人身份且有 AI 辅助开发证据的独立 Web 作品。' : '保留原有材料、练习、反馈与学习记录字段。'}</small></label>
          <Input
            label="作品地址"
            hint={categoryId === 'personal_site_portfolio' ? '可省略 https://；例如 example.test/my-portfolio' : '可省略 https://；例如 example.test/my-learning-tool'}
            error={validationError}
            value={url}
            inputMode="url"
            autoComplete="url"
            onChange={(event) => {
              setUrl(event.target.value)
              dispatch({ type: 'SUBMISSION_ENTRY_VALUE_SET', value: event.target.value })
              setTouched(true)
              setResult(null)
              setSavedDraftId(null)
            }}
            onBlur={() => {
              setTouched(true)
              if (!validateUrl(url)) {
                const normalized = normalizeSubmissionUrl(url.trim())
                setUrl(normalized)
                dispatch({ type: 'SUBMISSION_ENTRY_VALUE_SET', value: normalized })
              }
            }}
          />
          <div className="cluster">
            <Button variant="primary" type="submit" loading={checking} disabled={Boolean(validationError)}>
              检查地址
            </Button>
            {checking ? <Button type="button" onClick={cancelCheck}>取消检查</Button> : null}
          </div>
          {requestError ? <ErrorPanel title="检查未完成" message={requestError.message} onRetry={requestError.retryable ? () => void checkUrl() : undefined} /> : null}
          {cancelled ? <div className="feedback" role="status"><strong>检查已取消</strong><p>没有创建草稿，也没有发出重复检查。</p></div> : null}
        </form>

        <section className="url-check-panel stack" aria-labelledby="url-check-heading" aria-busy={checking || undefined}>
          <div className="stack stack--small">
            <h2 id="url-check-heading">检查进度</h2>
            <p>完成这些检查后，你就可以继续补充作品信息。</p>
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
                <p>社区里已经有这个作品，请先确认是否是同一个。</p>
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
                <p>如果名称相似但并非同一个作品，可以提交公开信息帮助我们核对。</p>
                <Link className="button" to="/about#corrections">了解如何提交纠错</Link>
              </details>
            </section>
          ) : result ? (
            <div className="url-check-outcome stack stack--small" role="status">
              <strong>{allPassed ? '地址检查通过' : result.canCreateDraft ? '检查未完全通过，可先保存草稿' : '当前地址不能创建发布草稿'}</strong>
              <div className="cluster">
                {result.canCreateDraft ? <Button type="button" onClick={saveDraft}>{savedDraftId ? '草稿已保存' : '保存地址草稿'}</Button> : null}
                {allPassed ? <Button type="button" variant="primary" onClick={continueNewSubmission}>继续补充作品信息</Button> : null}
                {!allPassed ? <Button type="button" variant="primary" disabled>继续发布</Button> : null}
              </div>
              {savedDraftId ? <p>草稿已保存，可以稍后从个人中心继续编辑。</p> : null}
              {allPassed ? <p>下一步将补充作品介绍、开发工具和可复用内容。</p> : null}
            </div>
          ) : null}
        </section>
      </div>
    </PageFrame>
  )
}
