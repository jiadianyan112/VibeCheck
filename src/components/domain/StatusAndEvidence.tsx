import { useState } from 'react'
import type {
  AccessStatus,
  CompletenessLevel,
  DisputeStatus,
  Evidence,
  EvidenceType,
  FreshnessStatus,
} from '../../types'
import { Drawer, Tag } from '../ui'
import { ExternalLinkGuard } from './ExternalLinkGuard'

const accessStatusLabels: Record<AccessStatus, string> = {
  normal: '正常可访问',
  login_required: '需要登录',
  pending_recheck: '等待复检',
  partial_abnormal: '部分异常',
  link_unavailable: '链接不可用',
  suspected_migration: '疑似迁移',
  paused: '已暂停',
  ended: '已结束',
  recovered: '已恢复',
  unknown: '未知',
}

const freshnessLabels: Record<FreshnessStatus, string> = {
  valid: '核验仍有效',
  expiring: '即将需要复检',
  expired: '信息已过期',
}

const completenessLabels: Record<CompletenessLevel, string> = {
  complete: '资料完整',
  partial: '资料部分完整',
  limited: '资料有限',
  pending_verification: '等待核验',
  disputed: '资料存在争议',
}

const disputeLabels: Record<Exclude<DisputeStatus, 'none'>, string> = {
  in_review: '争议核查中',
  resolved: '争议已处理',
  insufficient_evidence: '证据不足',
}

const evidenceTypeLabels: Record<EvidenceType, string> = {
  platform_verified_fact: '平台直接核验',
  verified_author_statement: '已验证作者声明',
  trusted_external_source: '可信外部来源',
  system_inference: '系统推断',
}

function formatCheckedAt(value: string | null) {
  if (!value) return '核验时间未知'
  return `核验于 ${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value))}`
}

export function AccessStatusBadge({ status }: { status: AccessStatus }) {
  const uncertain = status === 'unknown' || status === 'pending_recheck' || status === 'suspected_migration'
  return <Tag tone={uncertain ? 'dashed' : status === 'normal' || status === 'recovered' ? 'default' : 'strong'}>{accessStatusLabels[status]}</Tag>
}

export function FreshnessLabel({ status, lastVerifiedAt }: { status: FreshnessStatus; lastVerifiedAt: string | null }) {
  return (
    <span className={`fact-label fact-label--${status}`}>
      <strong>{freshnessLabels[status]}</strong>
      <span>{formatCheckedAt(lastVerifiedAt)}</span>
    </span>
  )
}

export function CompletenessLabel({ level }: { level: CompletenessLevel }) {
  return <Tag tone={level === 'complete' ? 'default' : 'dashed'}>{completenessLabels[level]}</Tag>
}

export function DisputeNotice({ status }: { status: DisputeStatus }) {
  if (status === 'none') return null
  return (
    <aside className="dispute-notice" role="note" aria-label="争议提示">
      <strong>{disputeLabels[status]}</strong>
      <p>以下信息保留原始说法与来源；在核查完成前不会自动覆盖为确定事实。</p>
    </aside>
  )
}

export function EvidenceBadge({ evidence }: { evidence: Evidence }) {
  return (
    <span className="evidence-badge">
      <Tag tone={evidence.type === 'system_inference' ? 'dashed' : 'default'}>{evidenceTypeLabels[evidence.type]}</Tag>
      {evidence.reviewStatus && evidence.reviewStatus !== 'current' ? <Tag tone="strong">{evidence.reviewStatus === 'expired' ? '证据已过期' : evidence.reviewStatus === 'insufficient' ? '证据不足' : '争议核查中'}</Tag> : null}
      <span>{formatCheckedAt(evidence.verifiedAt)}</span>
    </span>
  )
}

export function EvidenceDrawer({ label = '查看来源', evidences }: { label?: string; evidences: readonly Evidence[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="evidence-trigger" onClick={() => setOpen(true)}>
        {label}（{evidences.length}）
      </button>
      <Drawer open={open} title="事实来源与核验记录" onClose={() => setOpen(false)}>
        {evidences.length === 0 ? (
          <p className="unknown-value">未知：当前没有可引用的证据。</p>
        ) : (
          <ol className="evidence-list">
            {evidences.map((evidence) => (
              <li key={evidence.id} className="stack stack--small">
                <EvidenceBadge evidence={evidence} />
                <p>{evidence.sourceSummary}</p>
                <span>可信度：{evidence.confidence === 'high' ? '高' : evidence.confidence === 'medium' ? '中' : '低'}</span>
                {evidence.sourceUrl ? <ExternalLinkGuard href={evidence.sourceUrl}>打开原始来源</ExternalLinkGuard> : <span>来源地址未知</span>}
                <DisputeNotice status={evidence.disputeStatus} />
              </li>
            ))}
          </ol>
        )}
      </Drawer>
    </>
  )
}

export function UnknownFact({ reason }: { reason: string }) {
  return <span className="unknown-value">未知：{reason}</span>
}

export { accessStatusLabels, completenessLabels, evidenceTypeLabels, freshnessLabels }
