import type {
  FeedbackMethod,
  FieldFact,
  InputType,
  OutputType,
  PracticeFormat,
  Project,
  TargetUser,
  UseScenario,
} from '../../types'

export interface AdminProjectDraft {
  currentName: string
  originalPlatform: string
  oneLineDefinition: string
  coreProblem: string
  targetUsers: TargetUser[]
  useScenarios: UseScenario[]
  mainInputs: InputType[]
  mainOutputs: OutputType[]
  practiceFormats: PracticeFormat[]
  feedbackMethods: FeedbackMethod[]
  differentiation: string
  coreFeatures: string
  secondaryFeatures: string
  techStack: string
  modelsUsed: string
  deploymentPlatform: string
  developmentCycle: string
}

export type AdminProjectDraftErrors = Partial<Record<keyof AdminProjectDraft, string>>

function factValue<T>(fact: FieldFact<T>, fallback: T) {
  return fact.state === 'known' ? fact.value : fallback
}

function lineText(value: readonly string[]) {
  return value.join('\n')
}

function lines(value: string) {
  return [...new Set(value.split(/\r?\n|，|,/).map((item) => item.trim()).filter(Boolean))]
}

function known<T>(fact: FieldFact<T>, value: T): FieldFact<T> {
  return {
    ...fact,
    state: 'known',
    value,
  }
}

export function adminProjectDraftFrom(project: Project): AdminProjectDraft {
  return {
    currentName: factValue(project.currentName, ''),
    originalPlatform: factValue(project.originalPlatform, '') ?? '',
    oneLineDefinition: factValue(project.oneLineDefinition, ''),
    coreProblem: factValue(project.coreProblem, ''),
    targetUsers: factValue(project.targetUsers, []),
    useScenarios: factValue(project.useScenarios, []),
    mainInputs: factValue(project.mainInputs, []),
    mainOutputs: factValue(project.mainOutputs, []),
    practiceFormats: factValue(project.practiceFormats, []),
    feedbackMethods: factValue(project.feedbackMethods, []),
    differentiation: factValue(project.differentiation, ''),
    coreFeatures: lineText(factValue(project.coreFeatures, [])),
    secondaryFeatures: lineText(factValue(project.secondaryFeatures, [])),
    techStack: lineText(factValue(project.techStack, [])),
    modelsUsed: lineText(factValue(project.modelsUsed, [])),
    deploymentPlatform: factValue(project.deploymentPlatform, '') ?? '',
    developmentCycle: factValue(project.developmentCycle, '') ?? '',
  }
}

export function saveAdminProjectDraft(
  project: Project,
  draft: AdminProjectDraft,
  isAdministrator: boolean,
) {
  const errors: AdminProjectDraftErrors = {}
  if (!draft.currentName.trim()) errors.currentName = '作品名称不能为空。'
  else if (draft.currentName.trim().length > 80) errors.currentName = '作品名称不能超过 80 个字符。'
  if (!draft.oneLineDefinition.trim()) errors.oneLineDefinition = '一句话定义不能为空。'
  else if (draft.oneLineDefinition.trim().length > 180) errors.oneLineDefinition = '一句话定义不能超过 180 个字符。'
  if (project.categoryId === 'ai_learning_quiz') {
    if (!draft.coreProblem.trim()) errors.coreProblem = '核心问题不能为空。'
    if (!draft.targetUsers.length) errors.targetUsers = '至少选择一个目标用户。'
    if (!draft.useScenarios.length) errors.useScenarios = '至少选择一个使用场景。'
    if (!draft.mainInputs.length) errors.mainInputs = '至少选择一种主要输入。'
    if (!draft.mainOutputs.length) errors.mainOutputs = '至少选择一种主要输出。'
  }
  if (Object.keys(errors).length) return { project: null, errors }

  const next: Project = {
    ...project,
    currentName: known(project.currentName, draft.currentName.trim()),
    summary: known(project.summary, draft.oneLineDefinition.trim()),
    originalPlatform: isAdministrator
      ? known(project.originalPlatform, draft.originalPlatform.trim() || null)
      : project.originalPlatform,
    oneLineDefinition: known(project.oneLineDefinition, draft.oneLineDefinition.trim()),
    coreProblem: project.categoryId === 'ai_learning_quiz' ? known(project.coreProblem, draft.coreProblem.trim()) : project.coreProblem,
    targetUsers: project.categoryId === 'ai_learning_quiz' ? known(project.targetUsers, draft.targetUsers) : project.targetUsers,
    useScenarios: project.categoryId === 'ai_learning_quiz' ? known(project.useScenarios, draft.useScenarios) : project.useScenarios,
    mainInputs: project.categoryId === 'ai_learning_quiz' ? known(project.mainInputs, draft.mainInputs) : project.mainInputs,
    mainOutputs: project.categoryId === 'ai_learning_quiz' ? known(project.mainOutputs, draft.mainOutputs) : project.mainOutputs,
    practiceFormats: project.categoryId === 'ai_learning_quiz' ? known(project.practiceFormats, draft.practiceFormats) : project.practiceFormats,
    feedbackMethods: project.categoryId === 'ai_learning_quiz' ? known(project.feedbackMethods, draft.feedbackMethods) : project.feedbackMethods,
    differentiation: project.categoryId === 'ai_learning_quiz' ? known(project.differentiation, draft.differentiation.trim()) : project.differentiation,
    coreFeatures: project.categoryId === 'ai_learning_quiz' ? known(project.coreFeatures, lines(draft.coreFeatures)) : project.coreFeatures,
    secondaryFeatures: project.categoryId === 'ai_learning_quiz' ? known(project.secondaryFeatures, lines(draft.secondaryFeatures)) : project.secondaryFeatures,
    techStack: known(project.techStack, lines(draft.techStack)),
    modelsUsed: known(project.modelsUsed, lines(draft.modelsUsed)),
    deploymentPlatform: known(project.deploymentPlatform, draft.deploymentPlatform.trim() || null),
    developmentCycle: known(project.developmentCycle, draft.developmentCycle.trim() || null),
  }
  return { project: next, errors }
}
