import {
  evidenceId,
  lifecycleEventId,
  projectId,
  type EvidenceType,
  type LifecycleEvent,
  type LifecycleEventType,
} from '../types'

interface EventSeed {
  id: string
  projectKey: string
  type: LifecycleEventType
  happenedAt: string
  summary: string
  sourceType: EvidenceType
  evidenceKey: string
  changes?: LifecycleEvent['changes']
  disputeStatus?: LifecycleEvent['disputeStatus']
}

function makeEvent(seed: EventSeed): LifecycleEvent {
  return {
    id: lifecycleEventId(seed.id),
    projectId: projectId(seed.projectKey),
    type: seed.type,
    happenedAt: seed.happenedAt,
    isEstimatedDate: false,
    summary: seed.summary,
    sourceType: seed.sourceType,
    evidenceIds: [evidenceId(seed.evidenceKey)],
    changes: seed.changes ?? [],
    disputeStatus: seed.disputeStatus ?? 'none',
  }
}

export const lifecycleEvents: LifecycleEvent[] = [
  makeEvent({ id: 'event-quizforge-first', projectKey: 'project-quizforge', type: 'first_published', happenedAt: '2026-06-08T09:00:00+08:00', summary: '题练工坊首次公开发布。', sourceType: 'platform_verified_fact', evidenceKey: 'evidence-quizforge-public' }),
  makeEvent({ id: 'event-quizforge-v11', projectKey: 'project-quizforge', type: 'version_updated', happenedAt: '2026-07-23T10:00:00+08:00', summary: '1.1 版本新增简答题和答案解析。', sourceType: 'verified_author_statement', evidenceKey: 'evidence-quizforge-public', changes: [{ fieldKey: 'coreFeatures', before: ['选择题'], after: ['选择题', '简答题', '答案解析'] }] }),
  makeEvent({ id: 'event-quizforge-asset', projectKey: 'project-quizforge', type: 'asset_added', happenedAt: '2026-07-24T10:00:00+08:00', summary: '开放基础源码。', sourceType: 'trusted_external_source', evidenceKey: 'evidence-quizforge-repository' }),
  makeEvent({ id: 'event-pdfquizlab-first', projectKey: 'project-pdfquizlab', type: 'first_seen', happenedAt: '2026-06-15T11:00:00+08:00', summary: '平台首次收录 PDF 题库实验室。', sourceType: 'platform_verified_fact', evidenceKey: 'evidence-pdfquizlab-public' }),
  makeEvent({ id: 'event-papertopractice-abnormal', projectKey: 'project-papertopractice', type: 'link_abnormal', happenedAt: '2026-07-22T13:00:00+08:00', summary: '图片识别演示出现局部超时。', sourceType: 'platform_verified_fact', evidenceKey: 'evidence-papertopractice-public', changes: [{ fieldKey: 'accessStatus', before: 'normal', after: 'partial_abnormal' }] }),
  makeEvent({ id: 'event-speakmirror-first', projectKey: 'project-speakmirror', type: 'first_published', happenedAt: '2026-05-20T09:00:00+08:00', summary: '口语回声首次发布。', sourceType: 'verified_author_statement', evidenceKey: 'evidence-speakmirror-author' }),
  makeEvent({ id: 'event-speakmirror-v2', projectKey: 'project-speakmirror', type: 'version_updated', happenedAt: '2026-07-24T15:00:00+08:00', summary: '2.0 版本增加分项反馈。', sourceType: 'verified_author_statement', evidenceKey: 'evidence-speakmirror-author', changes: [{ fieldKey: 'feedbackMethods', before: ['scoring'], after: ['scoring', 'learning_suggestion', 'ai_follow_up'] }] }),
  makeEvent({ id: 'event-speakmirror-asset', projectKey: 'project-speakmirror', type: 'asset_added', happenedAt: '2026-07-25T15:00:00+08:00', summary: '开放口语反馈提示词结构。', sourceType: 'verified_author_statement', evidenceKey: 'evidence-speakmirror-author' }),
  makeEvent({ id: 'event-oralaiexam-first', projectKey: 'project-oralaiexam', type: 'first_published', happenedAt: '2026-06-22T09:00:00+08:00', summary: 'OralExam AI 首次公开。', sourceType: 'platform_verified_fact', evidenceKey: 'evidence-oralaiexam-public' }),
  makeEvent({ id: 'event-echoscore-ended', projectKey: 'project-echoscore', type: 'ended', happenedAt: '2026-07-12T18:00:00+08:00', summary: '作者确认产品实验结束。', sourceType: 'verified_author_statement', evidenceKey: 'evidence-echoscore-public', changes: [{ fieldKey: 'accessStatus', before: 'normal', after: 'ended' }] }),
  makeEvent({ id: 'event-echoscore-asset', projectKey: 'project-echoscore', type: 'asset_added', happenedAt: '2026-07-13T10:00:00+08:00', summary: '录音波形与回放组件继续开放。', sourceType: 'trusted_external_source', evidenceKey: 'evidence-echoscore-repository' }),
  makeEvent({ id: 'event-lexideck-v12', projectKey: 'project-lexideck', type: 'version_updated', happenedAt: '2026-07-20T12:00:00+08:00', summary: '1.2 版本加入间隔复习。', sourceType: 'trusted_external_source', evidenceKey: 'evidence-lexideck-repository' }),
  makeEvent({ id: 'event-lexideck-asset', projectKey: 'project-lexideck', type: 'asset_added', happenedAt: '2026-07-21T12:00:00+08:00', summary: '开放复习调度源码。', sourceType: 'trusted_external_source', evidenceKey: 'evidence-lexideck-repository' }),
  makeEvent({ id: 'event-dictaflow-redirect', projectKey: 'project-dictaflow', type: 'link_abnormal', happenedAt: '2026-07-21T09:30:00+08:00', summary: '旧地址发生重定向，新地址身份待确认。', sourceType: 'system_inference', evidenceKey: 'evidence-dictaflow-public', changes: [{ fieldKey: 'httpCheckStatus', before: 'normal', after: 'redirect' }], disputeStatus: 'in_review' }),
  makeEvent({ id: 'event-mistakeloop-first', projectKey: 'project-mistakeloop', type: 'first_published', happenedAt: '2026-07-02T08:30:00+08:00', summary: '错题回环首次发布。', sourceType: 'verified_author_statement', evidenceKey: 'evidence-mistakeloop-public' }),
  makeEvent({ id: 'event-mocksprint-paused', projectKey: 'project-mocksprint', type: 'paused', happenedAt: '2026-07-15T12:00:00+08:00', summary: '作者声明暂时暂停新功能开发。', sourceType: 'verified_author_statement', evidenceKey: 'evidence-mocksprint-public', changes: [{ fieldKey: 'accessStatus', before: 'normal', after: 'paused' }] }),
  makeEvent({ id: 'event-dailydrill-abnormal', projectKey: 'project-dailydrill', type: 'link_abnormal', happenedAt: '2026-07-17T10:30:00+08:00', summary: '连续检查后公开地址仍无法解析。', sourceType: 'platform_verified_fact', evidenceKey: 'evidence-dailydrill-public', changes: [{ fieldKey: 'accessStatus', before: 'pending_recheck', after: 'link_unavailable' }] }),
  makeEvent({ id: 'event-learntrack-first', projectKey: 'project-learntrack', type: 'first_seen', happenedAt: '2026-03-10T09:00:00+08:00', summary: '外部发布页记录 LearnTrack 曾公开。', sourceType: 'trusted_external_source', evidenceKey: 'evidence-learntrack-public' }),
  ...[
    ['atlas-home', 'Atlas Home'], ['quiet-index', 'Quiet Index'], ['stackfolio', 'Stackfolio'], ['terminal-craft', 'Terminal Craft'],
    ['form-field', 'Form & Field'], ['mono-studio', 'Mono Studio'], ['product-notes', 'Product Notes'], ['roadmap-self', 'Roadmap Self'],
    ['field-notes', 'Field Notes'], ['independent-room', 'Independent Room'], ['first-launch', 'First Launch'], ['campus-canvas', 'Campus Canvas'],
    ['one-page-cv', 'One Page CV'], ['brief-profile', 'Brief Profile'], ['lab-notebook', 'Lab Notebook'], ['scholar-site', 'Scholar Site'],
  ].map(([key, name], index) => makeEvent({
    id: `event-${key}-first`,
    projectKey: `project-${key}`,
    type: 'first_published',
    happenedAt: `2026-07-${String(10 + (index % 16)).padStart(2, '0')}T09:00:00+08:00`,
    summary: `${name} 首次公开发布。`,
    sourceType: 'verified_author_statement',
    evidenceKey: `evidence-${key}-public`,
  })),
]

export const eventById = new Map(lifecycleEvents.map((event) => [event.id, event]))
