import {
  assetId,
  comparisonSessionId,
  creatorId,
  decisionRecordId,
  notificationId,
  projectId,
  submissionDraftId,
  userId,
  verificationRequestId,
  type AuthorVerificationRequest,
  type ComparisonSession,
  type DecisionRecord,
  type Notification,
  type PrototypeUser,
  type SubmissionDraft,
  type UserAssets,
} from '../types'

export const prototypeUsers: PrototypeUser[] = [
  { id: userId('user-mia'), displayName: '米娅', role: 'user', creatorId: null },
  { id: userId('user-zhou'), displayName: '周可', role: 'verified_author', creatorId: creatorId('creator-zhou') },
  { id: userId('user-editor'), displayName: '平台编辑', role: 'editor', creatorId: null },
  { id: userId('user-admin'), displayName: '原型管理员', role: 'admin', creatorId: null },
]

export const comparisonSessions: ComparisonSession[] = [
  {
    id: comparisonSessionId('comparison-anonymous-pdf'),
    ownerUserId: null,
    intent: {
      originalQuery: '把 PDF 讲义生成练习题',
      targetUsers: ['university_students'],
      useScenarios: ['question_generation'],
      inputs: ['pdf'],
      practiceFormats: ['single_choice'],
      outputs: ['questions'],
    },
    projectIds: [projectId('project-quizforge'), projectId('project-pdfquizlab')],
    sourcePath: '/search?q=PDF',
    decisionId: null,
    createdAt: '2026-07-30T09:00:00+08:00',
    updatedAt: '2026-07-30T09:05:00+08:00',
    savedAt: null,
  },
  {
    id: comparisonSessionId('comparison-mia-speaking'),
    ownerUserId: userId('user-mia'),
    intent: {
      originalQuery: '比较口语模考的反馈方式',
      targetUsers: ['language_learners'],
      useScenarios: ['speaking_mock_exam'],
      inputs: ['audio'],
      practiceFormats: ['spoken_response'],
      outputs: ['score', 'learning_report'],
    },
    projectIds: [projectId('project-speakmirror'), projectId('project-oralaiexam'), projectId('project-echoscore')],
    sourcePath: '/discover/result',
    decisionId: decisionRecordId('decision-mia-speaking'),
    createdAt: '2026-07-29T13:00:00+08:00',
    updatedAt: '2026-07-29T13:20:00+08:00',
    savedAt: '2026-07-29T13:20:00+08:00',
  },
]

export const decisionRecords: DecisionRecord[] = [
  {
    id: decisionRecordId('decision-mia-speaking'),
    sessionId: comparisonSessionId('comparison-mia-speaking'),
    userId: userId('user-mia'),
    projectIds: [projectId('project-speakmirror'), projectId('project-oralaiexam'), projectId('project-echoscore')],
    action: 'reuse',
    affectedFields: ['core_flow', 'features', 'assets'],
    reason: '优先复用录音回放组件，并采用分项反馈结构。',
    assetIds: [assetId('asset-echoscore-component'), assetId('asset-speakmirror-prompt')],
    createdAt: '2026-07-29T13:20:00+08:00',
    visibility: 'private',
  },
]

export const submissionDrafts: SubmissionDraft[] = [
  {
    id: submissionDraftId('draft-mia-study-review'),
    userId: userId('user-mia'),
    status: 'draft',
    step: 'definition',
    fields: {
      publicUrl: 'https://example.test/products/mia-study-review',
      currentName: '学习复盘板',
      oneLineDefinition: '把练习结果整理成下一次复习计划。',
      targetUsers: ['university_students'],
    },
    originalExtraction: {
      publicUrl: 'https://example.test/products/mia-study-review',
      currentName: 'Study Review',
    },
    assetIds: [],
    duplicateProjectId: null,
    validationErrors: {},
    reviewMessages: {},
    submittedFields: null,
    submittedAssetIds: [],
    supplementalMaterial: '',
    publishedProjectId: null,
    publishedEventId: null,
    createdAt: '2026-07-30T15:00:00+08:00',
    updatedAt: '2026-07-30T15:10:00+08:00',
    submittedAt: null,
    withdrawnAt: null,
  },
]

export const verificationRequests: AuthorVerificationRequest[] = [
  {
    id: verificationRequestId('verification-mia-pdfquizlab'),
    projectId: projectId('project-pdfquizlab'),
    userId: userId('user-mia'),
    method: 'public_profile',
    status: 'pending',
    materialSummary: '公开个人主页包含作品地址。',
    privateMaterialReference: 'private://verification/verification-mia-pdfquizlab',
    reviewMessage: null,
    statusHistory: [{ status: 'pending', happenedAt: '2026-07-30T16:00:00+08:00', message: null }],
    createdAt: '2026-07-30T16:00:00+08:00',
    updatedAt: '2026-07-30T16:00:00+08:00',
    submittedAt: '2026-07-30T16:00:00+08:00',
    resolvedAt: null,
  },
]

export const notifications: Notification[] = [
  {
    id: notificationId('notification-speakmirror-v2'),
    userId: userId('user-mia'),
    type: 'project_updated',
    title: '口语回声发布 2.0',
    body: '新增发音、流利度和内容分项反馈。',
    targetPath: '/project/project-speakmirror#event-speakmirror-v2',
    projectId: projectId('project-speakmirror'),
    eventId: 'event-speakmirror-v2' as Notification['eventId'],
    isRead: false,
    createdAt: '2026-07-24T15:05:00+08:00',
  },
  {
    id: notificationId('notification-verification-pending'),
    userId: userId('user-mia'),
    type: 'verification_reviewed',
    title: '作者身份材料已进入人工审核',
    body: '材料只用于归属审核，不会公开展示。',
    targetPath: '/me?section=verification',
    projectId: projectId('project-pdfquizlab'),
    eventId: null,
    isRead: true,
    createdAt: '2026-07-30T16:01:00+08:00',
  },
  {
    id: notificationId('notification-dailydrill-status'),
    userId: userId('user-editor'),
    type: 'status_abnormal',
    title: 'DailyDrill 地址连续异常',
    body: '请复核 DNS 异常并确认是否需要更新公开状态。',
    targetPath: '/admin/status-monitor?project=project-dailydrill',
    projectId: projectId('project-dailydrill'),
    eventId: 'event-dailydrill-abnormal' as Notification['eventId'],
    isRead: false,
    createdAt: '2026-07-17T10:35:00+08:00',
  },
]

export const userAssets: UserAssets[] = [
  {
    userId: userId('user-mia'),
    favoriteProjectIds: [projectId('project-quizforge'), projectId('project-speakmirror'), projectId('project-echoscore')],
    followedProjectIds: [projectId('project-speakmirror'), projectId('project-lexideck')],
    recentProjectIds: [projectId('project-echoscore'), projectId('project-oralaiexam'), projectId('project-quizforge')],
    comparisonSessionIds: [comparisonSessionId('comparison-mia-speaking')],
    decisionRecordIds: [decisionRecordId('decision-mia-speaking')],
    submissionDraftIds: [submissionDraftId('draft-mia-study-review')],
    verificationRequestIds: [verificationRequestId('verification-mia-pdfquizlab')],
    notificationIds: [notificationId('notification-speakmirror-v2'), notificationId('notification-verification-pending')],
  },
  {
    userId: userId('user-editor'),
    favoriteProjectIds: [],
    followedProjectIds: [],
    recentProjectIds: [projectId('project-dailydrill')],
    comparisonSessionIds: [],
    decisionRecordIds: [],
    submissionDraftIds: [],
    verificationRequestIds: [],
    notificationIds: [notificationId('notification-dailydrill-status')],
  },
]

export const anonymousAssets = {
  comparisonSessionIds: [comparisonSessionId('comparison-anonymous-pdf')],
  recentProjectIds: [projectId('project-quizforge'), projectId('project-pdfquizlab')],
}
