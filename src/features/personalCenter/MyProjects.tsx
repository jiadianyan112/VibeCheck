import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button, EmptyState, LoadingState, Tag } from '../../components'
import { DeveloperApiError, developerApi, type MyProjectItem } from '../../services/developerApi'

interface MyProjectsProps {
  readonly userId: string
  readonly fallback: ReactNode
}

const verificationLabels: Record<NonNullable<MyProjectItem['verification_status']>, string> = {
  draft: '待补充材料',
  pending: '审核中',
  changes_requested: '需补充材料',
  verified: '已认证',
  failed: '认证未通过',
  withdrawn: '已撤回',
}

function developerLabel(item: MyProjectItem): string {
  if (!item.developer) return '开发主体待确认'
  return item.developer.kind === 'team' ? `开发团队 · ${item.developer.display_name}` : `个人开发 · ${item.developer.display_name}`
}

function verificationAction(item: MyProjectItem): { label: string; href: string } {
  const query = item.verification_id ? `?verification_id=${encodeURIComponent(item.verification_id)}` : ''
  if (item.verification_status === 'pending') return { label: '查看认证进度', href: `/project/${item.project_id}/verify-author${query}` }
  if (item.verification_status === 'changes_requested' || item.verification_status === 'draft') return { label: '继续身份认证', href: `/project/${item.project_id}/verify-author${query}` }
  return { label: '申请身份认证', href: `/project/${item.project_id}/verify-author${query}` }
}

function itemStatus(item: MyProjectItem): ReactNode {
  if (!item.verification_status) return <Tag tone="dashed">未认证</Tag>
  return <Tag tone={item.verification_status === 'verified' ? 'strong' : 'dashed'}>{verificationLabels[item.verification_status]}</Tag>
}

export function MyProjects({ userId, fallback }: MyProjectsProps) {
  const [items, setItems] = useState<readonly MyProjectItem[] | null>(null)
  const [loading, setLoading] = useState(import.meta.env.PROD)
  const [error, setError] = useState<DeveloperApiError | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const sequence = useRef(0)

  useEffect(() => {
    if (!import.meta.env.PROD) return undefined
    const controller = new AbortController()
    const currentSequence = ++sequence.current
    setItems(null)
    setLoading(true)
    setError(null)

    const load = async () => {
      const all: MyProjectItem[] = []
      let cursor: string | null = null
      try {
        do {
          const page = await developerApi.listMyProjects({ limit: 50, cursor, signal: controller.signal })
          all.push(...page.items)
          cursor = page.next_cursor
        } while (cursor && !controller.signal.aborted)
        if (controller.signal.aborted || currentSequence !== sequence.current) return
        const unique = [...new Map(all.map((item) => [item.project_id, item])).values()]
        setItems(unique)
      } catch (reason) {
        if (controller.signal.aborted || currentSequence !== sequence.current) return
        setError(reason instanceof DeveloperApiError ? reason : new DeveloperApiError('DEVELOPER_REQUEST_FAILED', 0))
      } finally {
        if (!controller.signal.aborted && currentSequence === sequence.current) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [retryKey, userId])

  if (!import.meta.env.PROD) return <>{fallback}</>
  if (loading) return <LoadingState label="我的作品加载中" />
  if (error) {
    const authExpired = error.status === 401 || error.code === 'AUTH_REQUIRED'
    return <div className="stack" role="alert"><p>{authExpired ? '登录状态已失效，请重新登录后再查看作品。' : '作品管理暂时不可用，请稍后重试。'}</p><div className="cluster"><Button variant="quiet" onClick={() => setRetryKey((current) => current + 1)}>重新加载</Button>{authExpired ? <Link className="button button--primary" to="/auth?return_to=%2Fme">重新登录</Link> : null}</div></div>
  }
  if (!items?.length) return <EmptyState title="还没有我的作品" description="发布作品后，可在这里查看审核进度和作品。" action={<Link className="button button--primary" to="/submit">发布作品</Link>} />

  return <ul className="personal-item-list">{items.map((item) => {
    const action = verificationAction(item)
    return <li key={item.project_id}>
      <div>
        <div className="cluster"><strong><Link to={`/project/${item.project_id}`}>{item.current_name || '名称未知作品'}</Link></strong>{itemStatus(item)}</div>
        <p>{developerLabel(item)}</p>
      </div>
      <div className="cluster"><Link className="button button--secondary" to={`/project/${item.project_id}`}>进入作品</Link>{item.can_manage ? <Link className="button button--primary" to={`/project/${item.project_id}/update`}>更新作品</Link> : <Link className="button button--secondary" to={action.href}>{action.label}</Link>}</div>
    </li>
  })}</ul>
}
