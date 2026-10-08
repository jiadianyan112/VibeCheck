import { useState } from 'react'
import { Link } from 'react-router-dom'
import './developerIdentity.css'

export type DeveloperKind = 'individual' | 'team' | null
export type DeveloperVerificationStatus = 'unverified' | 'verified' | 'disputed'

export interface DeveloperIdentityData {
  readonly kind: DeveloperKind
  readonly displayName: string
  readonly avatarUrl: string | null
  readonly websiteUrl: string | null
  readonly creatorId: string | null
  readonly verificationStatus: DeveloperVerificationStatus
}

interface DeveloperIdentityProps {
  readonly developer: DeveloperIdentityData | null | undefined
  readonly claimHref?: string
  readonly className?: string
}

function kindLabel(kind: DeveloperKind) {
  return kind === 'team' ? '开发团队' : '开发者'
}

function verificationLabel(status: DeveloperVerificationStatus, kind: DeveloperKind) {
  if (status === 'verified') return `已认证的${kindLabel(kind)}`
  if (status === 'disputed') return `归属争议中的${kindLabel(kind)}`
  return `未认证的${kindLabel(kind)}`
}

function ShieldIcon({ verified }: { verified: boolean }) {
  return <svg className="developer-identity__shield" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="M10 1.7 16.4 4v4.6c0 4.2-2.4 7.8-6.4 9.7-4-1.9-6.4-5.5-6.4-9.7V4L10 1.7Z" />
    {verified ? <path className="developer-identity__check" d="m6.5 10 2.2 2.2 4.8-5" /> : null}
  </svg>
}

function DeveloperAvatar({ developer }: { developer: DeveloperIdentityData }) {
  const [failed, setFailed] = useState(false)
  const initial = developer.displayName.trim().slice(0, 1) || '？'
  if (!developer.avatarUrl || failed) return <span className="developer-identity__avatar developer-identity__avatar--fallback" aria-label={`${developer.displayName}头像`}>{initial}</span>
  return <img className="developer-identity__avatar" src={developer.avatarUrl} alt={`${developer.displayName}头像`} onError={() => setFailed(true)} />
}

export function DeveloperIdentity({ developer, claimHref, className = '' }: DeveloperIdentityProps) {
  const [explanationOpen, setExplanationOpen] = useState(false)
  if (!developer) {
    return claimHref ? <div className={`developer-identity developer-identity--unknown ${className}`.trim()}><Link className="weak-link" to={claimHref}>认领作品</Link></div> : null
  }

  const kind = kindLabel(developer.kind)
  const verified = developer.verificationStatus === 'verified'
  const label = verificationLabel(developer.verificationStatus, developer.kind)
  const identity = <>
    <DeveloperAvatar developer={developer} />
    <span className="developer-identity__name">{developer.displayName}</span>
  </>

  return <div className={`developer-identity ${className}`.trim()} role="group" aria-label="作品开发主体">
    {developer.creatorId ? <Link className="developer-identity__person" to={`/creator/${developer.creatorId}`}>{identity}</Link> : <span className="developer-identity__person">{identity}</span>}
    <button
      type="button"
      className={`developer-identity__verification developer-identity__verification--${verified ? 'verified' : 'unverified'}`}
      aria-label={`${developer.displayName}：${label}`}
      aria-expanded={explanationOpen}
      title={`${label}身份`}
      onClick={() => setExplanationOpen(current => !current)}
    >
      <ShieldIcon verified={verified} />
    </button>
    <span className="developer-identity__kind">{kind}</span>
    <span className={`developer-identity__explanation${explanationOpen ? ' developer-identity__explanation--open' : ''}`} role="status">{verified ? '平台已完成当前作品开发主体认证。' : developer.verificationStatus === 'disputed' ? '当前作品的开发主体归属正在核对。' : '当前作品尚未完成开发主体认证。'}</span>
  </div>
}

