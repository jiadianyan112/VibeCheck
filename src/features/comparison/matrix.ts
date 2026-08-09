import type { EvidenceId, FieldFact, FreshnessStatus, Project, ProjectId, ReusableAsset } from '../../types'
import { accessStatusText, feedbackMethodLabels, inputTypeLabels, practiceFormatLabels, scenarioLabels, targetUserLabels } from '../../utils'

export type ComparisonDimensionId = 'positioning' | 'input-output' | 'flow' | 'features' | 'content-structure' | 'project-showcase' | 'visual-direction' | 'interaction' | 'site-capability' | 'implementation' | 'reuse-conditions' | 'status' | 'assets'

export interface ComparisonCell {
  projectId: ProjectId
  state: 'known' | 'unknown'
  lines: string[]
  reason: string | null
  signature: string
  evidenceIds: EvidenceId[]
  freshness: FreshnessStatus
  lastVerifiedAt: string | null
  prominent: boolean
}

export interface ComparisonRow {
  id: string
  label: string
  cells: ComparisonCell[]
  isSame: boolean
}

export interface ComparisonDimension {
  id: ComparisonDimensionId
  label: string
  rows: ComparisonRow[]
}

const outputLabels = { questions: '题目', practice_set: '练习集', exam: '试卷', score: '评分', answer_explanation: '答案解析', learning_report: '学习报告', mistake_set: '错题集', flashcards: '闪卡' } as const
const learningRecordLabels = { practice_history: '练习历史', accuracy: '正确率', progress: '学习进度', mistakes: '错题', spaced_repetition: '间隔复习', ability_analysis: '能力分析', learning_report: '学习报告' } as const
const aiToolLabels = { cursor: 'Cursor', lovable: 'Lovable', bolt: 'Bolt', v0: 'v0', replit: 'Replit', claude_code: 'Claude Code', codex: 'Codex', other: '其他', unknown: '未知' } as const
const loginLabels = { none: '无需登录', partial: '部分功能需登录', required: '必须登录', unknown: '未知' } as const
const sharingLabels = { none: '不可分享', link: '链接分享', result: '结果分享', question_bank: '题库分享', collaboration: '协作分享', unknown: '未知' } as const
const maintenanceLabels = { repository_updated: '代码仓库有更新', page_updated: '公开页面有更新', author_updated: '作者确认更新', no_public_change: '未见公开变化', unknown: '未知' } as const
const assetAvailabilityLabels = { available: '可获取', login_required: '登录后获取', link_abnormal: '链接异常', removed: '已移除', unknown: '状态未知' } as const
const freshnessLabels = { valid: '核验仍有效', expiring: '即将需要复检', expired: '信息已过期' } as const
const portfolioLabels: Record<string, string> = {
  personal_homepage: '个人主页', portfolio: '作品集', online_resume: '在线简历', academic_homepage: '学术主页', hybrid: '混合站点', developer: '开发者', designer: '设计师', product_manager: '产品经理', creator: '创作者', freelancer: '自由职业者', student_recruit: '学生/应届生', researcher_academic: '研究者', multidisciplinary: '跨领域创作者', other: '其他', showcase_projects: '展示项目', professional_presence: '职业形象', job_search: '求职', client_acquisition: '获取客户', personal_brand: '个人品牌', academic_profile: '学术档案', content_hub: '内容枢纽', single_page: '单页', multi_page: '多页', top_nav: '顶部导航', side_nav: '侧边导航', section_anchor: '章节锚点', minimal_overlay: '极简浮层', no_persistent_nav: '无常驻导航', hero: '首屏', about: '关于', projects: '项目', experience: '经历', skills: '技能', services: '服务', testimonials: '客户评价', contact: '联系', blog: '博客', resume: '简历', publications: '论文', speaking: '演讲', now_page: '近况', card_grid: '卡片网格', gallery: '画廊', timeline: '时间线', case_study_list: 'Case Study 列表', repository_list: '仓库列表', full_bleed: '通栏展示', mixed: '混合展示', none: '无', summary: '摘要', overview: '概览', deep: '深度', minimal: '极简', editorial: '编辑感', brutalist: '粗野主义', playful: '趣味', retro: '复古', corporate: '专业商务', experimental: '实验性', illustrative: '插画主导', photographic: '摄影主导', typographic: '字体主导', editorial_grid: '编辑网格', bento: 'Bento', split_screen: '分屏', immersive: '沉浸式', freeform: '自由布局', monochrome: '单色', neutral: '中性色', brand_led: '品牌色主导', vivid: '高饱和', gradient_dominant: '渐变主导', light_only: '仅浅色', dark_only: '仅深色', switchable: '可切换', system_adaptive: '跟随系统', static: '静态', light: '轻量', moderate: '中等', high: '高交互', microinteraction: '微交互', scroll_reveal: '滚动出现', scroll_driven: '滚动驱动', page_transition: '页面转场', cursor_effect: '光标效果', motion_graphics: '动态图形', confirmed: '已确认', partial: '部分支持', not_supported: '不支持', unknown: '未知', content_managed: 'CMS 管理',
}

function factCell<T>(projectId: ProjectId, fact: FieldFact<T>, format: (value: T) => string[], prominent = false): ComparisonCell {
  if (fact.state === 'unknown') {
    return { projectId, state: 'unknown', lines: [], reason: fact.reason, signature: `unknown:${fact.reason}`, evidenceIds: fact.evidenceIds, freshness: fact.freshness, lastVerifiedAt: fact.lastVerifiedAt, prominent }
  }
  const lines = format(fact.value)
  return { projectId, state: 'known', lines, reason: null, signature: `known:${[...lines].sort().join('|')}`, evidenceIds: fact.evidenceIds, freshness: fact.freshness, lastVerifiedAt: fact.lastVerifiedAt, prominent }
}

function simpleCell(project: Project, lines: string[], signature = lines.join('|')): ComparisonCell {
  return { projectId: project.id, state: 'known', lines, reason: null, signature: `known:${signature}`, evidenceIds: [], freshness: project.freshnessStatus, lastVerifiedAt: project.lastVerifiedAt, prominent: false }
}

function list<T extends string>(labels: Record<T, string>) {
  return (values: T[]) => values.map((value) => labels[value])
}

function portfolioLabel(value: string) { return portfolioLabels[value] ?? value }
function portfolioList(values: string[]) { return values.map(portfolioLabel) }

function row(id: string, label: string, cells: ComparisonCell[]): ComparisonRow {
  const canCollapse = cells.every(({ state, freshness }) => state === 'known' && freshness !== 'expired')
  return { id, label, cells, isSame: canCollapse && new Set(cells.map(({ signature }) => signature)).size === 1 }
}

function buildPortfolioMatrix(selected: readonly Project[], assets: readonly ReusableAsset[]): ComparisonDimension[] {
  const cells = (getCell: (project: Project) => ComparisonCell) => selected.map(getCell)
  const data = (project: Project) => project.categoryData!
  return [
    { id: 'positioning', label: '定位与用途', rows: [
      row('site-type', '网站类型', cells((p) => factCell(p.id, data(p).siteType, (v) => [portfolioLabel(v)]))),
      row('creator-roles', '作者身份', cells((p) => factCell(p.id, data(p).creatorRoles, portfolioList))),
      row('primary-goals', '建站目的', cells((p) => factCell(p.id, data(p).primaryGoals, portfolioList))),
    ] },
    { id: 'content-structure', label: '内容结构', rows: [
      row('page-model', '页面结构', cells((p) => factCell(p.id, data(p).pageModel, (v) => [portfolioLabel(v)]))),
      row('navigation', '导航方式', cells((p) => factCell(p.id, data(p).navigationPattern, (v) => [portfolioLabel(v)]))),
      row('modules', '核心模块', cells((p) => factCell(p.id, data(p).coreModules, portfolioList))),
      row('homepage-sequence', '首页顺序', cells((p) => factCell(p.id, data(p).homepageSequence, portfolioList))),
    ] },
    { id: 'project-showcase', label: '项目展示', rows: [
      row('showcase-format', '展示形式', cells((p) => factCell(p.id, data(p).projectShowcaseFormat, (v) => [portfolioLabel(v)]))),
      row('case-depth', 'Case Study 深度', cells((p) => factCell(p.id, data(p).caseStudyDepth, (v) => [portfolioLabel(v)]))),
    ] },
    { id: 'visual-direction', label: '视觉方向', rows: [
      row('visual-styles', '视觉风格', cells((p) => factCell(p.id, data(p).visualStyles, portfolioList))),
      row('layouts', '布局方式', cells((p) => factCell(p.id, data(p).layoutPatterns, portfolioList))),
      row('color', '色彩特征', cells((p) => factCell(p.id, data(p).colorCharacter, (v) => [portfolioLabel(v)]))),
      row('theme', '主题模式', cells((p) => factCell(p.id, data(p).themeMode, (v) => [portfolioLabel(v)]))),
    ] },
    { id: 'interaction', label: '交互动画', rows: [
      row('interaction-level', '交互等级', cells((p) => factCell(p.id, data(p).interactionLevel, (v) => [portfolioLabel(v)]))),
      row('interaction-patterns', '动画方式', cells((p) => factCell(p.id, data(p).interactionPatterns, portfolioList))),
    ] },
    { id: 'site-capability', label: '站点能力', rows: [
      row('responsive', '响应式', cells((p) => factCell(p.id, data(p).responsiveSupport, (v) => [portfolioLabel(v)]))),
      row('blog', '博客能力', cells((p) => factCell(p.id, data(p).blogSupport, (v) => [portfolioLabel(v)]))),
    ] },
    { id: 'implementation', label: '实现方式', rows: [
      row('ai-tools', 'AI 编程工具', cells((p) => factCell(p.id, p.aiCodingTools, list(aiToolLabels)))),
      row('tech-stack', '技术栈', cells((p) => factCell(p.id, p.techStack, (v) => v))),
      row('deployment', '部署平台', cells((p) => factCell(p.id, p.deploymentPlatform, (v) => [v ?? '未公开']))),
    ] },
    { id: 'reuse-conditions', label: '复用条件', rows: [row('reusable-assets', '公开资产', cells((p) => {
      const found = assets.filter((asset) => asset.projectId === p.id)
      return { ...simpleCell(p, found.length ? found.map((asset) => `${asset.name} · ${assetAvailabilityLabels[asset.availabilityStatus]}`) : ['暂无公开资产']), evidenceIds: found.flatMap((asset) => asset.evidenceIds) }
    }))] },
    { id: 'status', label: '状态与证据', rows: [
      row('access-status', '公开状态', cells((p) => factCell(p.id, p.accessStatus, (v) => [accessStatusText[v]]))),
      row('freshness', '资料时效', cells((p) => simpleCell(p, [freshnessLabels[p.freshnessStatus]]))),
      row('evidence', '核验依据', cells((p) => simpleCell(p, [p.authorLinkStatus === 'linked' ? '作者已关联' : '平台公开证据']))),
    ] },
  ]
}

function buildMixedCategoryMatrix(selected: readonly Project[], assets: readonly ReusableAsset[]): ComparisonDimension[] {
  const cells = (getCell: (project: Project) => ComparisonCell) => selected.map(getCell)
  return [
    { id: 'positioning', label: '跨品类概览', rows: [
      row('category', '作品品类', cells((p) => simpleCell(p, [p.categoryId === 'personal_site_portfolio' ? '个人主页与作品集' : 'AI 学习与题库']))),
      row('summary', '作品简介', cells((p) => factCell(p.id, p.summary, (v) => [v]))),
    ] },
    { id: 'implementation', label: '实现方式', rows: [row('ai-tools', 'AI 编程工具', cells((p) => factCell(p.id, p.aiCodingTools, list(aiToolLabels)))), row('tech-stack', '技术栈', cells((p) => factCell(p.id, p.techStack, (v) => v)))] },
    { id: 'assets', label: '复用条件', rows: [row('reusable-assets', '公开资产', cells((p) => simpleCell(p, assets.filter((asset) => asset.projectId === p.id).map((asset) => asset.name).length ? assets.filter((asset) => asset.projectId === p.id).map((asset) => asset.name) : ['暂无公开资产'])))] },
    { id: 'status', label: '状态与证据', rows: [row('access-status', '公开状态', cells((p) => factCell(p.id, p.accessStatus, (v) => [accessStatusText[v]]))), row('freshness', '资料时效', cells((p) => simpleCell(p, [freshnessLabels[p.freshnessStatus]])))] },
  ]
}

export function buildComparisonMatrix(selected: readonly Project[], assets: readonly ReusableAsset[]): ComparisonDimension[] {
  if (selected.length && selected.every((project) => project.categoryId === 'personal_site_portfolio')) return buildPortfolioMatrix(selected, assets)
  if (new Set(selected.map((project) => project.categoryId)).size > 1) return buildMixedCategoryMatrix(selected, assets)
  const cells = (getCell: (project: Project) => ComparisonCell) => selected.map(getCell)
  return [
    {
      id: 'positioning', label: '定位', rows: [
        row('definition', '一句话定义', cells((project) => factCell(project.id, project.oneLineDefinition, (value) => [value]))),
        row('target-users', '目标用户', cells((project) => factCell(project.id, project.targetUsers, list(targetUserLabels)))),
        row('core-problem', '核心问题', cells((project) => factCell(project.id, project.coreProblem, (value) => [value]))),
        row('scenarios', '使用场景', cells((project) => factCell(project.id, project.useScenarios, list(scenarioLabels)))),
      ],
    },
    {
      id: 'input-output', label: '输入输出', rows: [
        row('inputs', '主要输入', cells((project) => factCell(project.id, project.mainInputs, list(inputTypeLabels)))),
        row('outputs', '主要输出', cells((project) => factCell(project.id, project.mainOutputs, list(outputLabels)))),
        row('practice', '练习形式', cells((project) => factCell(project.id, project.practiceFormats, list(practiceFormatLabels)))),
      ],
    },
    {
      id: 'flow', label: '流程', rows: [
        row('core-flow', '核心流程', cells((project) => factCell(project.id, project.coreFlow, (value) => value.map((node) => `${node.order}. ${node.label}：${node.description}`)))),
      ],
    },
    {
      id: 'features', label: '功能', rows: [
        row('core-features', '核心功能', cells((project) => factCell(project.id, project.coreFeatures, (value) => value))),
        row('feedback', '反馈方式', cells((project) => factCell(project.id, project.feedbackMethods, list(feedbackMethodLabels)))),
        row('records', '学习记录', cells((project) => factCell(project.id, project.learningRecords, list(learningRecordLabels)))),
        row('difference', '差异化', cells((project) => factCell(project.id, project.differentiation, (value) => [value]))),
      ],
    },
    {
      id: 'implementation', label: '实现', rows: [
        row('ai-tools', 'AI 编程工具', cells((project) => factCell(project.id, project.aiCodingTools, list(aiToolLabels)))),
        row('models', '使用模型', cells((project) => factCell(project.id, project.modelsUsed, (value) => value))),
        row('tech-stack', '技术栈', cells((project) => factCell(project.id, project.techStack, (value) => value))),
        row('deployment', '部署平台', cells((project) => factCell(project.id, project.deploymentPlatform, (value) => [value ?? '未使用独立部署平台']))),
        row('development-cycle', '开发周期', cells((project) => factCell(project.id, project.developmentCycle, (value) => [value ?? '未公开']))),
      ],
    },
    {
      id: 'status', label: '当前状态', rows: [
        row('access-status', '公开状态', cells((project) => {
          const prominent = project.accessStatus.state === 'known' && !['normal', 'recovered'].includes(project.accessStatus.value)
          return factCell(project.id, project.accessStatus, (value) => [accessStatusText[value]], prominent)
        })),
        row('login', '登录要求', cells((project) => factCell(project.id, project.loginRequirement, (value) => [loginLabels[value]]))),
        row('sharing', '分享能力', cells((project) => factCell(project.id, project.sharingCapability, (value) => [sharingLabels[value]]))),
        row('maintenance', '维护信号', cells((project) => simpleCell(project, [maintenanceLabels[project.maintenanceSignal]]))),
        row('freshness', '资料时效', cells((project) => simpleCell(project, [freshnessLabels[project.freshnessStatus]], project.freshnessStatus))),
        row('status-note', '状态说明', cells((project) => factCell(project.id, project.statusNote, (value) => [value ?? '暂无额外说明']))),
      ],
    },
    {
      id: 'assets', label: '可复用资产', rows: [
        row('reusable-assets', '公开资产', cells((project) => {
          const projectAssets = assets.filter(({ projectId }) => projectId === project.id)
          const lines = projectAssets.length ? projectAssets.map((asset) => `${asset.name} · ${assetAvailabilityLabels[asset.availabilityStatus]}`) : ['暂无公开资产']
          return { ...simpleCell(project, lines), evidenceIds: projectAssets.flatMap(({ evidenceIds }) => evidenceIds) }
        })),
      ],
    },
  ]
}
