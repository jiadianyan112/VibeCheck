import { Button, Tag } from '../../components/ui'
import type { AssetType, ComparisonIntent, CreatorRole, InputType, OutputType, PageModel, PracticeFormat, PrimaryGoal, ProjectCategoryId, SiteType, TargetUser, UseScenario, VisualStyle } from '../../types'
import { creatorRoles, inputTypes, outputTypes, pageModels, practiceFormats, primaryGoals, siteTypes, targetUsers, useScenarios, visualStyles } from '../../types'
import { inputTypeLabels, practiceFormatLabels, scenarioLabels, targetUserLabels } from '../../utils'

const outputLabels: Record<OutputType, string> = { questions: '题目', practice_set: '练习集', exam: '试卷', score: '评分', answer_explanation: '答案解析', learning_report: '学习报告', mistake_set: '错题集', flashcards: '闪卡' }
const siteTypeLabels: Record<SiteType, string> = { personal_homepage: '个人主页', portfolio: '作品集', online_resume: '在线简历', academic_homepage: '学术主页', hybrid: '混合站点' }
const creatorRoleLabels: Record<CreatorRole, string> = { developer: '开发者', designer: '设计师', product_manager: '产品经理', creator: '创作者', freelancer: '自由职业者', student_recruit: '学生/应届生', researcher_academic: '研究者/学者', multidisciplinary: '跨领域创作者', other: '其他' }
const primaryGoalLabels: Record<PrimaryGoal, string> = { showcase_projects: '展示项目', professional_presence: '职业形象', job_search: '求职', client_acquisition: '获取客户', personal_brand: '个人品牌', academic_profile: '学术档案', content_hub: '内容枢纽', other: '其他' }
const pageModelLabels: Record<PageModel, string> = { single_page: '单页', multi_page: '多页', hybrid: '混合结构' }
const visualStyleLabels: Record<VisualStyle, string> = { minimal: '极简', editorial: '编辑感', brutalist: '粗野主义', playful: '趣味', retro: '复古', corporate: '专业商务', experimental: '实验性', illustrative: '插画主导', photographic: '摄影主导', typographic: '字体主导', other: '其他' }
const portfolioAssetTypes = ['source_code', 'starter', 'template', 'page_layout', 'ui_component', 'theme_design_system', 'other'] as const satisfies readonly AssetType[]
const assetTypeLabels: Record<AssetType, string> = { source_code: '源代码', starter: 'Starter', template: '模板', component: '组件', page_layout: '页面布局', ui_component: 'UI 组件', motion_interaction: '动画/交互', theme_design_system: '主题/设计系统', resume_module: '简历模块', blog_cms_module: '博客/CMS 模块', prompt: '提示词', parsing_solution: '解析方案', open_api: '开放 API', deployment_solution: '部署方案', deployment_config: '部署配置', design_file: '设计稿', other: '其他资产' }

function IntentField<T extends string>({ label, values, options, labels, onChange }: { label: string; values: T[]; options: readonly T[]; labels: Record<T, string>; onChange: (values: T[]) => void }) {
  return (
    <div className="field intent-field">
      <span className="field__label">{label}</span>
      <div className="cluster">{values.length ? values.map((item) => <span key={item} className="editable-tag"><Tag>{labels[item]}</Tag><Button variant="quiet" aria-label={`删除${label}：${labels[item]}`} onClick={() => onChange(values.filter((value) => value !== item))}>×</Button></span>) : <span className="unknown-value">尚未确认</span>}</div>
      <label><span className="sr-only">添加{label}</span><select className="input" aria-label={`添加${label}`} value="" onChange={(event) => { const item = event.target.value as T; if (item && !values.includes(item)) onChange([...values, item]) }}><option value="">＋ 添加标签</option>{options.filter((item) => !values.includes(item)).map((item) => <option key={item} value={item}>{labels[item]}</option>)}</select></label>
    </div>
  )
}

export function IntentEditor({ value, onChange }: { value: ComparisonIntent; onChange: (value: ComparisonIntent) => void }) {
  function changeCategory(categoryId: ProjectCategoryId | undefined) {
    onChange({
      ...value,
      categoryId,
      targetUsers: [], useScenarios: [], inputs: [], practiceFormats: [], outputs: [],
      siteTypes: [], creatorRoles: [], primaryGoals: [], pageModels: [], visualStyles: [], assetTypes: [],
    })
  }

  return (
    <div className="intent-editor stack">
      <div className="intent-original"><strong>你的原始想法</strong><blockquote>{value.originalQuery || '未输入'}</blockquote></div>
      <label className="field intent-category"><span className="field__label">作品品类</span><select className="input" aria-label="作品品类" value={value.categoryId ?? ''} onChange={(event) => changeCategory((event.target.value || undefined) as ProjectCategoryId | undefined)}><option value="">请选择作品品类</option><option value="ai_learning_quiz">AI 学习与题库</option><option value="personal_site_portfolio">个人主页与作品集</option></select></label>
      {!value.categoryId ? <p className="boundary-note">先选择作品品类，我们只会展示该品类需要确认的条件。</p> : null}
      {value.categoryId === 'personal_site_portfolio' ? <div className="intent-fields">
        <IntentField label="网站类型" values={value.siteTypes ?? []} options={siteTypes} labels={siteTypeLabels} onChange={(siteTypes: SiteType[]) => onChange({ ...value, siteTypes })} />
        <IntentField label="作者身份" values={value.creatorRoles ?? []} options={creatorRoles} labels={creatorRoleLabels} onChange={(creatorRoles: CreatorRole[]) => onChange({ ...value, creatorRoles })} />
        <IntentField label="建站目的" values={value.primaryGoals ?? []} options={primaryGoals} labels={primaryGoalLabels} onChange={(primaryGoals: PrimaryGoal[]) => onChange({ ...value, primaryGoals })} />
        <IntentField label="页面结构" values={value.pageModels ?? []} options={pageModels} labels={pageModelLabels} onChange={(pageModels: PageModel[]) => onChange({ ...value, pageModels })} />
        <IntentField label="视觉方向" values={value.visualStyles ?? []} options={visualStyles} labels={visualStyleLabels} onChange={(visualStyles: VisualStyle[]) => onChange({ ...value, visualStyles })} />
        <IntentField label="希望复用" values={value.assetTypes ?? []} options={portfolioAssetTypes} labels={assetTypeLabels} onChange={(assetTypes: AssetType[]) => onChange({ ...value, assetTypes })} />
      </div> : value.categoryId === 'ai_learning_quiz' ? <div className="intent-fields">
        <IntentField label="目标用户" values={value.targetUsers} options={targetUsers} labels={targetUserLabels} onChange={(targetUsers: TargetUser[]) => onChange({ ...value, targetUsers })} />
        <IntentField label="使用场景" values={value.useScenarios} options={useScenarios} labels={scenarioLabels} onChange={(useScenarios: UseScenario[]) => onChange({ ...value, useScenarios })} />
        <IntentField label="主要输入" values={value.inputs} options={inputTypes} labels={inputTypeLabels} onChange={(inputs: InputType[]) => onChange({ ...value, inputs })} />
        <IntentField label="练习形式" values={value.practiceFormats} options={practiceFormats} labels={practiceFormatLabels} onChange={(practiceFormats: PracticeFormat[]) => onChange({ ...value, practiceFormats })} />
        <IntentField label="主要输出" values={value.outputs} options={outputTypes} labels={outputLabels} onChange={(outputs: OutputType[]) => onChange({ ...value, outputs })} />
      </div> : null}
    </div>
  )
}
