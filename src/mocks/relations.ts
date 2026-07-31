import { evidenceId, projectId, relationId, type ProjectRelation } from '../types'

export const projectRelations: ProjectRelation[] = [
  {
    id: relationId('relation-quizforge-pdfquizlab'),
    type: 'similar',
    sourceProjectId: projectId('project-quizforge'),
    targetProjectId: projectId('project-pdfquizlab'),
    direction: 'two_way',
    confirmationStatus: 'platform_confirmed',
    summary: '都以 PDF 为主要输入并生成选择题。',
    evidenceIds: [evidenceId('evidence-quizforge-public'), evidenceId('evidence-pdfquizlab-public')],
  },
  {
    id: relationId('relation-quizforge-papertopractice'),
    type: 'alternative',
    sourceProjectId: projectId('project-quizforge'),
    targetProjectId: projectId('project-papertopractice'),
    direction: 'two_way',
    confirmationStatus: 'platform_confirmed',
    summary: '后者强化扫描材料 OCR，形成不同输入路径。',
    evidenceIds: [evidenceId('evidence-quizforge-public'), evidenceId('evidence-papertopractice-public')],
  },
  {
    id: relationId('relation-speakmirror-oralaiexam'),
    type: 'alternative',
    sourceProjectId: projectId('project-speakmirror'),
    targetProjectId: projectId('project-oralaiexam'),
    direction: 'two_way',
    confirmationStatus: 'platform_confirmed',
    summary: '一个侧重开放练习，一个侧重正式考试流程。',
    evidenceIds: [evidenceId('evidence-speakmirror-public'), evidenceId('evidence-oralaiexam-public')],
  },
  {
    id: relationId('relation-speakmirror-echoscore'),
    type: 'uses_asset',
    sourceProjectId: projectId('project-speakmirror'),
    targetProjectId: projectId('project-echoscore'),
    direction: 'one_way',
    confirmationStatus: 'one_party_confirmed',
    summary: '口语回声的录音界面参考了 EchoScore 开放组件。',
    evidenceIds: [evidenceId('evidence-speakmirror-author'), evidenceId('evidence-echoscore-repository')],
  },
]
