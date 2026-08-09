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
  {
    id: relationId('relation-form-atlas'), type: 'reference', sourceProjectId: projectId('project-form-field'), targetProjectId: projectId('project-atlas-home'), direction: 'one_way', confirmationStatus: 'one_party_confirmed', summary: 'Form & Field 作者声明参考了 Atlas Home 的身份与项目章节顺序。', evidenceIds: [evidenceId('evidence-form-field-public'), evidenceId('evidence-atlas-home-public')],
  },
  {
    id: relationId('relation-terminal-stack'), type: 'fork', sourceProjectId: projectId('project-terminal-craft'), targetProjectId: projectId('project-stackfolio'), direction: 'one_way', confirmationStatus: 'platform_confirmed', summary: 'Terminal Craft 从 Stackfolio 的公开源码分支后重做为终端式导航。', evidenceIds: [evidenceId('evidence-terminal-craft-public'), evidenceId('evidence-stackfolio-public')],
  },
  {
    id: relationId('relation-first-atlas'), type: 'based_on_template', sourceProjectId: projectId('project-first-launch'), targetProjectId: projectId('project-atlas-home'), direction: 'one_way', confirmationStatus: 'one_party_confirmed', summary: 'First Launch 基于 Atlas Starter 调整了学生项目和求职模块。', evidenceIds: [evidenceId('evidence-first-launch-public'), evidenceId('evidence-atlas-home-public')],
  },
  {
    id: relationId('relation-scholar-lab'), type: 'source_derivative', sourceProjectId: projectId('project-scholar-site'), targetProjectId: projectId('project-lab-notebook'), direction: 'one_way', confirmationStatus: 'platform_confirmed', summary: 'Scholar Site 是 Lab Notebook 学术主题的精简衍生版本。', evidenceIds: [evidenceId('evidence-scholar-site-public'), evidenceId('evidence-lab-notebook-public')],
  },
]
