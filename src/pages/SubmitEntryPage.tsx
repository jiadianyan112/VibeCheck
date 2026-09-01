import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Input, StatusBeacon, StepRail, TaskShell, useToast } from '../components'
import type { StatusTone, TaskStepItem } from '../components'
import { useOptionalAuthSession } from '../features/auth/AuthSessionContext'
import { canContinueAfterUrlCheck, urlCheckLabels } from '../features/submission/urlCheck'
import {
  makeSubmissionClientRequestId,
  normalizeSubmissionUrl,
  remoteDraftToLocalDraft,
  submissionApi,
  SubmissionApiError,
  type UrlCheckItem,
  type UrlCheckResult,
} from '../services/submissionApi'
import { useAppState } from '../state'
import type { ProjectCategoryId, SubmissionDraft } from '../types'

const checkOrder: UrlCheckItem['key'][] = [
  'format',
  'safety',
  'access',
  'duplicate',
  'category',
]

const taskSteps: readonly TaskStepItem[] = [
  { id: 'address', label: '检查地址', state: 'current' },
  { id: 'details', label: '基础信息', state: 'upcoming' },
  { id: 'purpose', label: '定位与用途', state: 'upcoming' },
  { id: 'content', label: '核心内容', state: 'upcoming' },
  { id: 'assets', label: '开发与资产', state: 'upcoming' },
  { id: 'preview', label: '预览与提交', state: 'upcoming' },
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

function duplicateProjectPath(id: string, url: string, verification = false) {
  const params = new URLSearchParams({ from: 'submit', submissionUrl: url })
  return `/project/${id}${verification ? '/verify-author' : ''}?${params}`
}

export function SubmitEntryPage() {
  const { state, dispatch } = useAppState()
  const { pushToast } = useToast()
  const auth = useOptionalAuthSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [url, setUrl] = useState(() => searchParams.get('resumeUrl') ?? state.submissionEntryValue)
  const [categoryId, setCategoryId] = useState<ProjectCategoryId>(() => {
    const requestedCategory = searchParams.get('category')
    return requestedCategory === 'personal_site_portfolio' || requestedCategory === 'ai_learning_quiz'
      ? requestedCategory
      : state.submissionEntryCategoryId
  })
  const [touched, setTouched] = useState(false)
  const [checking, setChecking] = useState(false)
  const [creating, setCreating] = useState(false)
  const [result, setResult] = useState<UrlCheckResult | null>(null)
  const [requestError, setRequestError] = useState<SubmissionApiError | null>(null)
  const [cancelled, setCancelled] = useState(false)
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null)
  const [savedDraft, setSavedDraft] = useState<SubmissionDraft | null>(null)
  const [declaredAuthor, setDeclaredAuthor] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const checkRequestIdRef = useRef('')
  const createRequestIdRef = useRef('')
  const autoCheckKeyRef = useRef('')
  const validationError = touched ? validateUrl(url) : ''

  useEffect(() => () => controllerRef.current?.abort(), [])

  useEffect(() => {
    if (state.submissionEntryCategoryId !== categoryId) dispatch({ type: 'SUBMISSION_ENTRY_CATEGORY_SET', categoryId })
  }, [categoryId, dispatch, state.submissionEntryCategoryId])

  useEffect(() => {
    setSavedDraft(null)
    setSavedDraftId(null)
    checkRequestIdRef.current = ''
    createRequestIdRef.current = ''
  }, [categoryId])

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

    if (!checkRequestIdRef.current) checkRequestIdRef.current = makeSubmissionClientRequestId()
    try {
      const data = await submissionApi.check({
        rawUrl: url.trim(),
        categoryId,
        session: auth?.session ?? null,
        signal: controller.signal,
        clientRequestId: checkRequestIdRef.current,
      })
      if (controllerRef.current !== controller) return
      setUrl(data.normalizedUrl)
      dispatch({ type: 'SUBMISSION_ENTRY_VALUE_SET', value: data.normalizedUrl })
      setResult(data)
      checkRequestIdRef.current = ''
      if (data.duplicateProjectId) {
        const nextParams = new URLSearchParams(searchParams)
        nextParams.set('resumeUrl', data.normalizedUrl)
        setSearchParams(nextParams, { replace: true })
      }
    } catch (error) {
      if (controllerRef.current !== controller) return
      if (error instanceof SubmissionApiError && error.kind === 'aborted') {
        setCancelled(true)
      } else if (error instanceof SubmissionApiError) {
        setRequestError(error)
      } else {
        setRequestError(new SubmissionApiError({ code: 'CLIENT_REQUEST_FAILED', message: '检查未完成，当前内容已保留。', status: null, requestId: null, retryable: true, retryAfterMs: null, kind: 'transport' }))
      }
    } finally {
      if (controllerRef.current === controller) setChecking(false)
    }
  }, [auth?.session, categoryId, checking, dispatch, searchParams, setSearchParams, url])

  useEffect(() => {
    if (!state.session.user || searchParams.get('autoCheck') !== '1') return
    const autoCheckKey = `${categoryId}:${searchParams.get('resumeUrl') ?? ''}`
    if (autoCheckKeyRef.current === autoCheckKey) return
    autoCheckKeyRef.current = autoCheckKey
    void checkUrl()
  }, [categoryId, checkUrl, searchParams, state.session.user])

  const checkByKey = useMemo(
    () => new Map(result?.checks.map((check) => [check.key, check]) ?? []),
    [result],
  )

  const cancelCheck = () => {
    controllerRef.current?.abort()
  }

  const createDraft = useCallback(async () => {
    if (!result?.canCreateDraft || !state.session.user || !result.checkId || savedDraft) return savedDraft
    if (!createRequestIdRef.current) createRequestIdRef.current = makeSubmissionClientRequestId()
    const controller = new AbortController()
    controllerRef.current?.abort()
    controllerRef.current = controller
    setCreating(true)
    setRequestError(null)
    try {
      const remote = await submissionApi.create({
        checkId: result.checkId,
        categoryId: result.categoryId ?? categoryId,
        session: auth?.session ?? null,
        signal: controller.signal,
        clientRequestId: createRequestIdRef.current,
      })
      const draft = remoteDraftToLocalDraft(remote, state.session.user.id, undefined, 'prefill')
      dispatch({ type: 'DRAFT_UPSERT', draft })
      setSavedDraft(draft)
      setSavedDraftId(draft.id)
      pushToast('草稿已保存。', 'success')
      return draft
    } catch (error) {
      if (error instanceof SubmissionApiError) setRequestError(error)
      else setRequestError(new SubmissionApiError({ code: 'CLIENT_REQUEST_FAILED', message: '草稿未保存，当前内容已保留。', status: null, requestId: null, retryable: true, retryAfterMs: null, kind: 'transport' }))
      return null
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        setCreating(false)
      }
    }
  }, [auth?.session, categoryId, dispatch, pushToast, result, savedDraft, state.session.user])

  const saveDraft = () => { void createDraft() }

  const continueNewSubmission = async () => {
    if (!result || !allPassed || !state.session.user) return
    const draft = await createDraft()
    if (draft) navigate(`/submit/new?${new URLSearchParams({ draft: draft.id, step: 'prefill' })}`)
  }

  const allPassed = result ? canContinueAfterUrlCheck(result) : false
  const duplicateCandidate = result?.duplicateCandidate ?? null

  const statusTone: StatusTone = !state.session.user
    ? 'idle'
    : requestError
      ? 'error'
      : checking || creating
        ? 'progress'
        : cancelled || duplicateCandidate
          ? 'warning'
          : result
            ? allPassed
              ? 'success'
              : result.canCreateDraft ? 'warning' : 'error'
            : 'idle'
  const statusLabel = !state.session.user
    ? '登录后开始'
    : requestError
      ? '需要处理'
      : checking
        ? '正在检查'
        : creating
          ? '正在保存草稿'
          : cancelled
            ? '等待下一次检查'
            : duplicateCandidate
              ? '发现已有档案'
              : result
                ? allPassed
                  ? '检查通过'
                  : result.canCreateDraft ? '需要处理' : '无法继续'
                : '等待检查'
  const statusDetail = !state.session.user
    ? '登录后可检查地址并保存草稿。'
    : requestError
      ? '请在检查区域查看详情，并在适合时重试。'
      : (checking
        ? '正在确认格式、安全、访问、查重和品类。'
        : creating
          ? '请稍候，检查结果仍会保留。'
          : cancelled
            ? '当前内容已保留，未创建草稿。'
            : duplicateCandidate
              ? '不会创建重复草稿，请先查看或验证身份。'
              : result
                ? allPassed
                  ? '可以继续补充作品信息。'
                  : result.canCreateDraft
                    ? '可先保存草稿；全部检查通过后才能继续。'
                    : '当前地址不能创建发布草稿。'
                : '完成地址检查后再继续。')

  const statusAside = (
    <div className="submit-entry-aside stack stack--small">
      <StatusBeacon tone={statusTone} label={statusLabel} detail={statusDetail} />
      {result?.canCreateDraft && !allPassed ? <p className="submit-entry-aside__note">保存草稿不会开始发布；通过全部检查后才能继续。</p> : null}
      {duplicateCandidate ? <p className="submit-entry-aside__note">已有档案不会被覆盖，也不会创建重复作品。</p> : null}
    </div>
  )

  if (!state.session.user) {
    const returnPath = encodeURIComponent(`${location.pathname}${location.search}`)
    return (
      <div className="highfi-scope submit-entry-scope">
        <TaskShell
          eyebrow="发布作品"
          title="发布作品"
          description="登录后保存草稿，并跟踪审核进度。"
          rail={<StepRail steps={taskSteps} />}
          aside={statusAside}
        >
          <section className="submit-entry-login stack stack--small" aria-labelledby="submit-login-heading">
            <header className="submit-entry-panel__header stack stack--small">
              <p className="submit-entry-panel__eyebrow">开始发布</p>
              <h2 id="submit-login-heading">先登录，再检查作品地址</h2>
            </header>
            <p>登录后会回到这里，刚才的作品地址不会丢失。</p>
            <Link className="button button--primary" to={`/auth?return_to=${returnPath}`}>
              登录后发布
            </Link>
          </section>
        </TaskShell>
      </div>
    )
  }

  return (
    <div className="highfi-scope submit-entry-scope">
      <TaskShell
        eyebrow="发布作品"
        title="先检查作品地址"
        description="输入公开地址，先确认可访问、符合收录范围且没有重复档案。"
        rail={<StepRail steps={taskSteps} />}
        aside={statusAside}
      >
        <div className="submit-entry-main">
          <form className="submit-entry-form stack" onSubmit={checkUrl} noValidate>
            <header className="submit-entry-panel__header stack stack--small">
              <p className="submit-entry-panel__eyebrow">第一步 · 地址</p>
              <h2>公开访问 URL</h2>
              <p>先选品类，再检查公开地址。</p>
            </header>
            <label className="field"><span className="field__label">作品品类</span><select className="input" value={categoryId} onChange={(event) => { const nextCategoryId = event.target.value as ProjectCategoryId; setCategoryId(nextCategoryId); dispatch({ type: 'SUBMISSION_ENTRY_CATEGORY_SET', categoryId: nextCategoryId }); setResult(null); setSavedDraftId(null) }}><option value="ai_learning_quiz">AI 学习与题库</option><option value="personal_site_portfolio">个人主页与作品集</option></select><small>{categoryId === 'personal_site_portfolio' ? '无需登录即可查看主要内容，并能确认个人身份和 AI 辅助开发。' : '保留原有材料、练习、反馈与学习记录字段。'}</small></label>
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
                setSavedDraft(null)
                setSavedDraftId(null)
                checkRequestIdRef.current = ''
                createRequestIdRef.current = ''
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
            <div className="cluster submit-entry-actions">
              <Button variant="primary" type="submit" loading={checking} disabled={Boolean(validationError)}>
                检查地址
              </Button>
              {checking ? <Button type="button" onClick={cancelCheck}>取消检查</Button> : null}
            </div>
            {requestError ? <section className="feedback feedback--error submit-entry-feedback" role="alert"><strong>检查未完成</strong><p>{requestError.message}</p>{requestError.retryable ? <Button type="button" onClick={() => void checkUrl()}>重试</Button> : null}</section> : null}
            {cancelled ? <div className="feedback submit-entry-feedback" role="status"><strong>检查已取消</strong><p>没有创建草稿，也没有发出重复检查。</p></div> : null}
          </form>

          <section className="submit-entry-checks stack" aria-labelledby="url-check-heading" aria-busy={checking || undefined}>
            <header className="submit-entry-panel__header stack stack--small">
              <p className="submit-entry-panel__eyebrow">检查结果</p>
              <h2 id="url-check-heading">检查进度</h2>
              <p>完成这些检查后，才能继续补充作品信息。</p>
            </header>
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

            {duplicateCandidate && result ? (
              <section className="duplicate-branch submit-entry-duplicate stack" aria-labelledby="duplicate-heading">
                <div className="stack stack--small">
                  <p className="eyebrow">发现已有档案</p>
                  <h3 id="duplicate-heading">{duplicateCandidate.currentName}</h3>
                  <p>这个地址已有社区档案，请先确认是否是同一个作品。</p>
                </div>
                <dl className="duplicate-summary">
                  <div><dt>匹配地址</dt><dd>{result.normalizedUrl}</dd></div>
                </dl>
                <Link
                  className="button button--primary"
                  to={duplicateProjectPath(duplicateCandidate.projectId, result.normalizedUrl)}
                >
                  查看已有作品详情
                </Link>
                <label className="choice-card duplicate-author-choice">
                  <input
                    type="checkbox"
                    checked={declaredAuthor}
                    onChange={(event) => setDeclaredAuthor(event.target.checked)}
                  />
                  <span><strong>我是该作品作者，并需要管理档案</strong><small>继续前往身份验证，不会创建重复作品。</small></span>
                </label>
                {declaredAuthor ? (
                  <Link
                    className="weak-link"
                    to={duplicateProjectPath(duplicateCandidate.projectId, result.normalizedUrl, true)}
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
                <div className="cluster submit-entry-actions">
                  {result.canCreateDraft ? <Button type="button" loading={creating} onClick={saveDraft}>{savedDraftId ? '草稿已保存' : '保存地址草稿'}</Button> : null}
                  {allPassed ? <Button type="button" variant="primary" loading={creating} onClick={() => void continueNewSubmission()}>继续补充作品信息</Button> : null}
                  {!allPassed ? <Button type="button" variant="primary" disabled>继续发布</Button> : null}
                </div>
                {savedDraftId ? <p>草稿已保存，可以稍后从个人中心继续编辑。</p> : null}
                {allPassed ? <p>下一步将补充作品介绍、开发工具和可复用内容。</p> : null}
              </div>
            ) : null}
          </section>
        </div>
      </TaskShell>
    </div>
  )
}
