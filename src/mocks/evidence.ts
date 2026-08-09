import {
  evidenceId,
  projectId,
  type DisputeStatus,
  type Evidence,
  type EvidenceType,
} from '../types'

interface EvidenceSeed {
  id: string
  projectKey: string
  type: EvidenceType
  summary: string
  verifiedAt: string
  disputeStatus?: DisputeStatus
  sourceUrl?: string | null
}

function makeEvidence(seed: EvidenceSeed): Evidence {
  return {
    id: evidenceId(seed.id),
    type: seed.type,
    sourceUrl: seed.sourceUrl ?? `https://example.test/evidence/${seed.id}`,
    sourceSummary: seed.summary,
    capturedAt: seed.verifiedAt,
    verifiedAt: seed.verifiedAt,
    confidence: seed.type === 'system_inference' ? 'low' : 'high',
    disputeStatus: seed.disputeStatus ?? 'none',
    supports: {
      projectId: projectId(seed.projectKey),
      fieldKey: 'oneLineDefinition',
    },
  }
}

export const evidences: Evidence[] = [
  makeEvidence({ id: 'evidence-quizforge-public', projectKey: 'project-quizforge', type: 'platform_verified_fact', summary: '公开页面可访问并展示 PDF 生成题目流程。', verifiedAt: '2026-07-28T09:00:00+08:00' }),
  makeEvidence({ id: 'evidence-quizforge-repository', projectKey: 'project-quizforge', type: 'trusted_external_source', summary: '公开仓库包含材料导入和练习记录代码。', verifiedAt: '2026-07-28T09:05:00+08:00' }),
  makeEvidence({ id: 'evidence-pdfquizlab-public', projectKey: 'project-pdfquizlab', type: 'platform_verified_fact', summary: '公开落地页要求登录后进入题库生成。', verifiedAt: '2026-07-20T10:00:00+08:00' }),
  makeEvidence({ id: 'evidence-papertopractice-public', projectKey: 'project-papertopractice', type: 'platform_verified_fact', summary: '文字 PDF 流程可访问，图片识别接口偶发超时。', verifiedAt: '2026-07-22T13:00:00+08:00' }),
  makeEvidence({ id: 'evidence-speakmirror-public', projectKey: 'project-speakmirror', type: 'platform_verified_fact', summary: '公开演示展示口语录制与分项反馈。', verifiedAt: '2026-07-27T14:00:00+08:00' }),
  makeEvidence({ id: 'evidence-speakmirror-author', projectKey: 'project-speakmirror', type: 'verified_author_statement', summary: '作者公开说明反馈维度和提示词许可。', verifiedAt: '2026-07-27T14:05:00+08:00' }),
  makeEvidence({ id: 'evidence-oralaiexam-public', projectKey: 'project-oralaiexam', type: 'platform_verified_fact', summary: '公开页面展示登录门槛与计时口语流程。', verifiedAt: '2026-07-26T15:00:00+08:00' }),
  makeEvidence({ id: 'evidence-echoscore-public', projectKey: 'project-echoscore', type: 'verified_author_statement', summary: '作者说明产品实验结束，组件继续开放。', verifiedAt: '2026-07-18T16:00:00+08:00' }),
  makeEvidence({ id: 'evidence-echoscore-repository', projectKey: 'project-echoscore', type: 'trusted_external_source', summary: '公开仓库仍提供录音回放组件。', verifiedAt: '2026-07-18T16:05:00+08:00' }),
  makeEvidence({ id: 'evidence-lexideck-public', projectKey: 'project-lexideck', type: 'platform_verified_fact', summary: '公开演示展示卡片和间隔复习队列。', verifiedAt: '2026-07-25T11:00:00+08:00' }),
  makeEvidence({ id: 'evidence-lexideck-repository', projectKey: 'project-lexideck', type: 'trusted_external_source', summary: '仓库包含固定数据驱动的复习调度实现。', verifiedAt: '2026-07-25T11:05:00+08:00' }),
  makeEvidence({ id: 'evidence-dictaflow-public', projectKey: 'project-dictaflow', type: 'system_inference', summary: '旧地址重定向到新域名，但作品身份尚未确认。', verifiedAt: '2026-07-21T09:30:00+08:00', disputeStatus: 'in_review' }),
  makeEvidence({ id: 'evidence-mistakeloop-public', projectKey: 'project-mistakeloop', type: 'platform_verified_fact', summary: '公开页面展示错题采集与复习流程。', verifiedAt: '2026-07-29T08:30:00+08:00' }),
  makeEvidence({ id: 'evidence-mocksprint-public', projectKey: 'project-mocksprint', type: 'verified_author_statement', summary: '作者声明暂停新功能，现有演示仍保留。', verifiedAt: '2026-07-19T12:00:00+08:00' }),
  makeEvidence({ id: 'evidence-dailydrill-public', projectKey: 'project-dailydrill', type: 'platform_verified_fact', summary: '连续两次公开地址 DNS 检查异常。', verifiedAt: '2026-07-17T10:30:00+08:00' }),
  makeEvidence({ id: 'evidence-learntrack-public', projectKey: 'project-learntrack', type: 'trusted_external_source', summary: '历史发布页证明作品曾存在，当前公开入口未知。', verifiedAt: '2026-06-10T09:00:00+08:00' }),
  ...[
    ['atlas-home', 'Atlas Home'], ['quiet-index', 'Quiet Index'], ['stackfolio', 'Stackfolio'], ['terminal-craft', 'Terminal Craft'],
    ['form-field', 'Form & Field'], ['mono-studio', 'Mono Studio'], ['product-notes', 'Product Notes'], ['roadmap-self', 'Roadmap Self'],
    ['field-notes', 'Field Notes'], ['independent-room', 'Independent Room'], ['first-launch', 'First Launch'], ['campus-canvas', 'Campus Canvas'],
    ['one-page-cv', 'One Page CV'], ['brief-profile', 'Brief Profile'], ['lab-notebook', 'Lab Notebook'], ['scholar-site', 'Scholar Site'],
  ].map(([key, name]) => makeEvidence({
    id: `evidence-${key}-public`,
    projectKey: `project-${key}`,
    type: 'verified_author_statement',
    summary: `${name} 的公开站点、个人身份与 AI 辅助开发声明已核验。`,
    verifiedAt: '2026-08-08T10:00:00+08:00',
  })),
]

export const evidenceById = new Map(evidences.map((evidence) => [evidence.id, evidence]))
