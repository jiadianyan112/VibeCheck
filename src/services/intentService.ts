import type { AssetType, ComparisonIntent, ConfidenceLevel, CreatorRole, InputType, OutputType, PageModel, PracticeFormat, PrimaryGoal, SiteType, TargetUser, UseScenario, VisualStyle } from '../types'
import { inferIdeaCategory } from '../features/discovery/searchRouting'
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

interface PortfolioRulePatch {
  siteTypes?: SiteType[]
  creatorRoles?: CreatorRole[]
  primaryGoals?: PrimaryGoal[]
  pageModels?: PageModel[]
  visualStyles?: VisualStyle[]
  assetTypes?: AssetType[]
}

interface PortfolioIntentRule { name: string; pattern: RegExp; patch: PortfolioRulePatch }

const portfolioRules: PortfolioIntentRule[] = [
  { name: '个人主页', pattern: /个人主页|个人网站|个人站点|个人品牌/i, patch: { siteTypes: ['personal_homepage'], primaryGoals: ['professional_presence', 'personal_brand'] } },
  { name: '作品集', pattern: /作品集|portfolio|项目展示|案例展示/i, patch: { siteTypes: ['portfolio'], primaryGoals: ['showcase_projects'] } },
  { name: '在线简历', pattern: /在线简历|简历站|求职|找工作/i, patch: { siteTypes: ['online_resume'], primaryGoals: ['job_search'] } },
  { name: '学术主页', pattern: /学术主页|研究者|论文|学术档案/i, patch: { siteTypes: ['academic_homepage'], creatorRoles: ['researcher_academic'], primaryGoals: ['academic_profile'] } },
  { name: '开发者', pattern: /开发者|程序员|工程师|开源项目|github/i, patch: { creatorRoles: ['developer'] } },
  { name: '设计师', pattern: /设计师|设计作品/i, patch: { creatorRoles: ['designer'] } },
  { name: '产品经理', pattern: /产品经理|产品案例/i, patch: { creatorRoles: ['product_manager'] } },
  { name: '自由职业', pattern: /自由职业|接单|客户|获客/i, patch: { creatorRoles: ['freelancer'], primaryGoals: ['client_acquisition'] } },
  { name: '内容中心', pattern: /博客|文章|内容中心|内容枢纽/i, patch: { primaryGoals: ['content_hub'] } },
  { name: '单页结构', pattern: /单页|一页式|one.page/i, patch: { pageModels: ['single_page'] } },
  { name: '多页结构', pattern: /多页|多个页面|multi.page/i, patch: { pageModels: ['multi_page'] } },
  { name: '极简风格', pattern: /极简|minimal/i, patch: { visualStyles: ['minimal'] } },
  { name: '编辑风格', pattern: /编辑感|杂志感|editorial/i, patch: { visualStyles: ['editorial'] } },
  { name: '源码资产', pattern: /源码|源代码|代码仓库|starter/i, patch: { assetTypes: ['source_code'] } },
  { name: '模板资产', pattern: /模板|主题|设计系统/i, patch: { assetTypes: ['template'] } },
]

function appendUnique<T>(current: T[], values: T[] | undefined) {
  return values ? [...new Set([...current, ...values])] : current
}

export function parseIntent(rawText: string): IntentParseResult {
  const raw = rawText.trim()
  const categoryId = inferIdeaCategory(raw)
  const intent: ComparisonIntent = {
    originalQuery: rawText,
    categoryId,
    targetUsers: [],
    useScenarios: [],
    inputs: [],
    practiceFormats: [],
    outputs: [],
    siteTypes: [],
    creatorRoles: [],
    primaryGoals: [],
    pageModels: [],
    visualStyles: [],
    assetTypes: [],
  }
  const matchedRules: string[] = []
  if (categoryId === 'personal_site_portfolio') {
    for (const rule of portfolioRules) {
      if (!rule.pattern.test(raw)) continue
      matchedRules.push(rule.name)
      intent.siteTypes = appendUnique(intent.siteTypes ?? [], rule.patch.siteTypes)
      intent.creatorRoles = appendUnique(intent.creatorRoles ?? [], rule.patch.creatorRoles)
      intent.primaryGoals = appendUnique(intent.primaryGoals ?? [], rule.patch.primaryGoals)
      intent.pageModels = appendUnique(intent.pageModels ?? [], rule.patch.pageModels)
      intent.visualStyles = appendUnique(intent.visualStyles ?? [], rule.patch.visualStyles)
      intent.assetTypes = appendUnique(intent.assetTypes ?? [], rule.patch.assetTypes)
    }
  } else {
    intent.categoryId = categoryId ?? (rules.some((rule) => rule.pattern.test(raw)) ? 'ai_learning_quiz' : undefined)
    for (const rule of rules) {
      if (!rule.pattern.test(raw)) continue
      matchedRules.push(rule.name)
      intent.targetUsers = appendUnique(intent.targetUsers, rule.patch.targetUsers)
      intent.useScenarios = appendUnique(intent.useScenarios, rule.patch.useScenarios)
      intent.inputs = appendUnique(intent.inputs, rule.patch.inputs)
      intent.practiceFormats = appendUnique(intent.practiceFormats, rule.patch.practiceFormats)
      intent.outputs = appendUnique(intent.outputs, rule.patch.outputs)
    }
  }
  const dimensions = (intent.categoryId === 'personal_site_portfolio'
    ? [intent.siteTypes, intent.creatorRoles, intent.primaryGoals, intent.pageModels, intent.visualStyles, intent.assetTypes]
    : [intent.targetUsers, intent.useScenarios, intent.inputs, intent.practiceFormats, intent.outputs])
    .filter((values) => (values?.length ?? 0) > 0).length
  if (!raw || !intent.categoryId || dimensions === 0) return { status: 'failed', confidence: 'low', rawText: rawText, intent, matchedRules, message: '还没有找到足够的信息，请先选择作品品类，再补充你想参考的方向。' }
  const confidence: ConfidenceLevel = dimensions >= 4 ? 'high' : dimensions >= 3 ? 'medium' : 'low'
  const categoryName = intent.categoryId === 'personal_site_portfolio' ? '个人主页与作品集' : 'AI 学习与题库'
  return { status: dimensions >= 3 ? 'parsed' : 'partial', confidence, rawText: rawText, intent, matchedRules, message: dimensions >= 3 ? `已识别为${categoryName}，你可以继续核对。` : `已识别为${categoryName}，请补充一两个方向后继续。` }
}

export const intentService = {
  parse(rawText: string, options?: ServiceOptions) {
    return runService(options, () => options?.scenario === 'parse_failure'
      ? { ...parseIntent(''), rawText, intent: { originalQuery: rawText, targetUsers: [], useScenarios: [], inputs: [], practiceFormats: [], outputs: [], siteTypes: [], creatorRoles: [], primaryGoals: [], pageModels: [], visualStyles: [], assetTypes: [] }, message: '暂时无法整理这段想法：原始内容已保留，可以手动补充。' }
      : parseIntent(rawText))
  },
}
