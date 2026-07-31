import { Button, Tag } from '../../components/ui'
import type { ComparisonIntent, InputType, OutputType, PracticeFormat, TargetUser, UseScenario } from '../../types'
import { inputTypes, outputTypes, practiceFormats, targetUsers, useScenarios } from '../../types'
import { inputTypeLabels, practiceFormatLabels, scenarioLabels, targetUserLabels } from '../../utils'

const outputLabels: Record<OutputType, string> = { questions: '题目', practice_set: '练习集', exam: '试卷', score: '评分', answer_explanation: '答案解析', learning_report: '学习报告', mistake_set: '错题集', flashcards: '闪卡' }

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
  return (
    <div className="intent-editor stack">
      <div className="intent-original"><span className="eyebrow">原始文本（始终保留）</span><blockquote>{value.originalQuery || '未输入'}</blockquote></div>
      <div className="intent-fields">
        <IntentField label="目标用户" values={value.targetUsers} options={targetUsers} labels={targetUserLabels} onChange={(targetUsers: TargetUser[]) => onChange({ ...value, targetUsers })} />
        <IntentField label="使用场景" values={value.useScenarios} options={useScenarios} labels={scenarioLabels} onChange={(useScenarios: UseScenario[]) => onChange({ ...value, useScenarios })} />
        <IntentField label="主要输入" values={value.inputs} options={inputTypes} labels={inputTypeLabels} onChange={(inputs: InputType[]) => onChange({ ...value, inputs })} />
        <IntentField label="练习形式" values={value.practiceFormats} options={practiceFormats} labels={practiceFormatLabels} onChange={(practiceFormats: PracticeFormat[]) => onChange({ ...value, practiceFormats })} />
        <IntentField label="主要输出" values={value.outputs} options={outputTypes} labels={outputLabels} onChange={(outputs: OutputType[]) => onChange({ ...value, outputs })} />
      </div>
    </div>
  )
}
