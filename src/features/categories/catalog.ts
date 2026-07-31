import type { Project, UseScenario } from '../../types'

export interface CategoryDefinition {
  slug: string
  name: string
  shortProblem: string
  boundary: string
  solutionPaths: string[]
  scenario: UseScenario
  requirePdf?: boolean
}

export const categoryCatalog: readonly CategoryDefinition[] = [
  { slug: 'ai-question-generation', name: 'AI 出题', shortProblem: '把已有材料快速变成可练习的问题', boundary: '收录以材料为输入、生成题目或练习集的公开 Web 作品。', solutionPaths: ['解析材料后生成题目', '基于预设知识点组织练习'], scenario: 'question_generation' },
  { slug: 'pdf-to-quiz', name: 'PDF 转题库', shortProblem: '把 PDF 讲义或试卷转换为题库', boundary: '必须明确支持 PDF 输入；只做摘要而不形成练习闭环的作品不在此类。', solutionPaths: ['直接解析文字 PDF', 'OCR 处理扫描 PDF'], scenario: 'question_generation', requirePdf: true },
  { slug: 'daily-practice', name: '刷题', shortProblem: '持续完成小批量练习并获得反馈', boundary: '强调日常练习与反馈记录，不以一次完整考试为主。', solutionPaths: ['固定题库日练', '按薄弱点生成练习'], scenario: 'daily_practice' },
  { slug: 'mock-exam', name: '模拟考试', shortProblem: '在接近考试的约束下完成整套练习', boundary: '包含计时、整卷或评分流程；普通单题练习不归入此类。', solutionPaths: ['预设题库模考', '语音或开放题模考'], scenario: 'mock_exam' },
  { slug: 'vocabulary-review', name: '背词', shortProblem: '记忆词汇并安排后续复习', boundary: '围绕词汇卡片、回忆练习或间隔复习形成闭环。', solutionPaths: ['闪卡回忆', '间隔复习队列'], scenario: 'vocabulary_memory' },
  { slug: 'speaking-practice', name: '口语', shortProblem: '练习口语表达并获得结构化反馈', boundary: '包含录音、口语作答或分项评价，不收录纯文字聊天工具。', solutionPaths: ['自由表达分项反馈', '计时口语模考'], scenario: 'speaking_mock_exam' },
  { slug: 'dictation-training', name: '听写', shortProblem: '通过音频输入训练听辨和拼写', boundary: '主要练习形式必须包含听写，普通音频播放工具不归入此类。', solutionPaths: ['句子分段听写', '错词回放与复练'], scenario: 'dictation_training' },
  { slug: 'mistake-review', name: '错题复习', shortProblem: '收集错题并组织再次练习', boundary: '必须围绕错题采集、归类或复练，单纯笔记工具不归入此类。', solutionPaths: ['拍照录入错题', '按知识点安排复练'], scenario: 'mistake_review' },
]

export function projectMatchesCategory(project: Project, category: CategoryDefinition) {
  if (project.useScenarios.state !== 'known' || !project.useScenarios.value.includes(category.scenario)) return false
  if (category.requirePdf && (project.mainInputs.state !== 'known' || !project.mainInputs.value.includes('pdf'))) return false
  return true
}

export function getCategory(slug: string | undefined) {
  return categoryCatalog.find((category) => category.slug === slug)
}
