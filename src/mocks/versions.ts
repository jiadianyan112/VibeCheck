import { evidenceId, projectId, versionId, type ProjectVersion } from '../types'

export const projectVersions: ProjectVersion[] = [
  {
    id: versionId('version-quizforge-1-1'),
    projectId: projectId('project-quizforge'),
    name: '1.1',
    releasedAt: '2026-07-23T10:00:00+08:00',
    summary: '增加简答题与答案解析。',
    evidenceIds: [evidenceId('evidence-quizforge-public')],
  },
  {
    id: versionId('version-speakmirror-2'),
    projectId: projectId('project-speakmirror'),
    name: '2.0',
    releasedAt: '2026-07-24T15:00:00+08:00',
    summary: '把综合评分拆分为发音、流利度和内容反馈。',
    evidenceIds: [evidenceId('evidence-speakmirror-author')],
  },
  {
    id: versionId('version-lexideck-1-2'),
    projectId: projectId('project-lexideck'),
    name: '1.2',
    releasedAt: '2026-07-20T12:00:00+08:00',
    summary: '加入间隔复习队列和错词筛选。',
    evidenceIds: [evidenceId('evidence-lexideck-repository')],
  },
]
