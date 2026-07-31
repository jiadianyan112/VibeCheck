import type { ComparisonIntent, ConfidenceLevel, InputType, OutputType, PracticeFormat, TargetUser, UseScenario } from '../types'
import { runService, type ServiceOptions } from './runtime'

export interface IntentParseResult {
  status: 'parsed' | 'partial' | 'failed'
  confidence: ConfidenceLevel
  rawText: string
  intent: ComparisonIntent
  matchedRules: string[]
  message: string
}

interface RulePatch {
  targetUsers?: TargetUser[]
  useScenarios?: UseScenario[]
  inputs?: InputType[]
  practiceFormats?: PracticeFormat[]
  outputs?: OutputType[]
}

interface IntentRule { name: string; pattern: RegExp; patch: RulePatch }

const rules: IntentRule[] = [
  { name: 'PDF 材料', pattern: /pdf|讲义|文档/i, patch: { inputs: ['pdf'] } },
  { name: '生成题目', pattern: /出题|生成.{0,4}(题|练习)|题库/i, patch: { useScenarios: ['question_generation'], practiceFormats: ['single_choice', 'short_answer'], outputs: ['questions', 'practice_set'] } },
  { name: '口语练习', pattern: /口语|发音|说话/i, patch: { targetUsers: ['language_learners'], inputs: ['audio'], practiceFormats: ['spoken_response'] } },
  { name: '口语模考', pattern: /口语.{0,6}(模考|考试)|雅思口语|面试口语/i, patch: { useScenarios: ['speaking_mock_exam'], outputs: ['score', 'learning_report'] } },
  { name: '评分反馈', pattern: /评分|打分|反馈/i, patch: { outputs: ['score', 'learning_report'] } },
  { name: '词汇记忆', pattern: /背词|单词|词汇/i, patch: { targetUsers: ['language_learners'], useScenarios: ['vocabulary_memory'], inputs: ['plain_text', 'manual_entry'] } },
  { name: '卡片练习', pattern: /卡片|闪卡|flashcard/i, patch: { practiceFormats: ['flashcard'], outputs: ['flashcards'] } },
  { name: '听写训练', pattern: /听写/i, patch: { targetUsers: ['language_learners'], useScenarios: ['dictation_training'], inputs: ['audio'], practiceFormats: ['dictation'], outputs: ['practice_set'] } },
  { name: '错题复习', pattern: /错题|做错/i, patch: { useScenarios: ['mistake_review'], inputs: ['image', 'manual_entry'], outputs: ['mistake_set'] } },
  { name: '完整模考', pattern: /模考|模拟考试/i, patch: { useScenarios: ['mock_exam'], practiceFormats: ['full_mock_exam'], outputs: ['exam', 'score'] } },
  { name: '大学学习者', pattern: /大学|高校|讲义/i, patch: { targetUsers: ['university_students'] } },
  { name: '中学生', pattern: /初中|高中|中学生/i, patch: { targetUsers: ['secondary_students'] } },
  { name: '教师', pattern: /老师|教师|教学/i, patch: { targetUsers: ['teachers'] } },
]

function appendUnique<T>(current: T[], values: T[] | undefined) {
  return values ? [...new Set([...current, ...values])] : current
}

export function parseIntent(rawText: string): IntentParseResult {
  const raw = rawText.trim()
  const intent: ComparisonIntent = { originalQuery: rawText, targetUsers: [], useScenarios: [], inputs: [], practiceFormats: [], outputs: [] }
  const matchedRules: string[] = []
  for (const rule of rules) {
    if (!rule.pattern.test(raw)) continue
    matchedRules.push(rule.name)
    intent.targetUsers = appendUnique(intent.targetUsers, rule.patch.targetUsers)
    intent.useScenarios = appendUnique(intent.useScenarios, rule.patch.useScenarios)
    intent.inputs = appendUnique(intent.inputs, rule.patch.inputs)
    intent.practiceFormats = appendUnique(intent.practiceFormats, rule.patch.practiceFormats)
    intent.outputs = appendUnique(intent.outputs, rule.patch.outputs)
  }
  const dimensions = [intent.targetUsers, intent.useScenarios, intent.inputs, intent.practiceFormats, intent.outputs].filter((values) => values.length > 0).length
  if (!raw || dimensions === 0) return { status: 'failed', confidence: 'low', rawText: rawText, intent, matchedRules, message: '没有识别出可核对的学习练习意图，请手动补充字段。' }
  const confidence: ConfidenceLevel = dimensions >= 4 ? 'high' : dimensions >= 3 ? 'medium' : 'low'
  return { status: dimensions >= 3 ? 'parsed' : 'partial', confidence, rawText: rawText, intent, matchedRules, message: dimensions >= 3 ? '已按固定规则提取，可继续编辑确认。' : '只识别出部分字段，请手动补充后继续。' }
}

export const intentService = {
  parse(rawText: string, options?: ServiceOptions) {
    return runService(options, () => options?.scenario === 'parse_failure'
      ? { ...parseIntent(''), rawText, intent: { originalQuery: rawText, targetUsers: [], useScenarios: [], inputs: [], practiceFormats: [], outputs: [] }, message: '模拟解析失败：已保留原始文本，可手动填写。' }
      : parseIntent(rawText))
  },
}
