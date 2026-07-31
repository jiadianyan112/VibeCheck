import type { EvidenceId, FieldFact, FreshnessStatus, Project, ProjectId, ReusableAsset } from '../../types'
import { accessStatusText, feedbackMethodLabels, inputTypeLabels, practiceFormatLabels, scenarioLabels, targetUserLabels } from '../../utils'

export type ComparisonDimensionId = 'positioning' | 'input-output' | 'flow' | 'features' | 'implementation' | 'status' | 'assets'

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

function row(id: string, label: string, cells: ComparisonCell[]): ComparisonRow {
  const canCollapse = cells.every(({ state, freshness }) => state === 'known' && freshness !== 'expired')
  return { id, label, cells, isSame: canCollapse && new Set(cells.map(({ signature }) => signature)).size === 1 }
}

export function buildComparisonMatrix(selected: readonly Project[], assets: readonly ReusableAsset[]): ComparisonDimension[] {
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
