import { useState, useSyncExternalStore, type ReactNode } from 'react'
import type { SubmissionProjectFields } from '../../types'
import { VibeLens } from '../brand'
import { accessStatusText } from '../../utils'

const desktopQuery = '(min-width: 1024px)'
function subscribeViewport(listener: () => void) {
  const media = window.matchMedia?.(desktopQuery)
  media?.addEventListener('change', listener)
  return () => media?.removeEventListener('change', listener)
}
function desktopSnapshot() { return window.matchMedia?.(desktopQuery).matches ?? false }

export function TaskPreview({ children }: { children: ReactNode }) {
  const desktop = useSyncExternalStore(subscribeViewport, desktopSnapshot, () => false)
  const [expanded, setExpanded] = useState(false)
  return <details className="task-preview" open={desktop || expanded}>
    <summary onClick={(event) => { event.preventDefault(); setExpanded((value) => !value) }} onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setExpanded((value) => !value) }
    }}>查看作品预览</summary>
    <div className="task-preview__content">{children}</div>
  </details>
}

function PreviewCover({ src, name, seed, portfolio }: { src?: string; name: string; seed: string; portfolio: boolean }) {
  const [failed, setFailed] = useState(false)
  return <div className="live-preview__media">
    {src && !failed ? <img src={src} alt={`${name}的封面预览`} onError={() => setFailed(true)} />
      : <VibeLens seed={seed} tone={portfolio ? 'violet' : 'lime'} state="idle" label="默认封面" />}
    <span className="live-preview__media-label">{src && !failed ? '本机封面预览' : '默认封面'}</span>
  </div>
}

export function LivePreview({ fields, coverUrl }: { fields: Partial<SubmissionProjectFields>; coverUrl?: string }) {
  const name = fields.currentName?.trim() || '你的下一件作品'
  const portfolio = fields.categoryId === 'personal_site_portfolio'
  return <article className="live-preview" aria-label="社区卡片预览">
    <p className="eyebrow">作品预览</p>
    <PreviewCover key={coverUrl ?? 'default'} src={coverUrl} name={name} seed={fields.publicUrl ?? 'submission'} portfolio={portfolio} />
    <div className="live-preview__copy">
      <span className="live-preview__category">{portfolio ? '个人主页与作品集' : 'AI 学习与题库'}</span>
      <p className="live-preview__category">{fields.accessStatus ? accessStatusText[fields.accessStatus] : '访问状态未填写'}</p>
      <h2>{name}</h2>
      <p>{fields.oneLineDefinition?.trim() || '一句话，介绍你正在创造什么。'}</p>
      <p className="live-preview__url">{fields.publicUrl || '填写公开地址后显示在这里'}</p>
      <small>随填写内容更新，提交审核后才会进入收录流程。</small>
    </div>
  </article>
}
