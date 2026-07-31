import type { ComparisonIntent, InputType, OutputType, PracticeFormat, TargetUser, UseScenario } from '../../types'
import { inputTypes, outputTypes, practiceFormats, targetUsers, useScenarios } from '../../types'
import { inputTypeLabels, practiceFormatLabels, scenarioLabels, targetUserLabels } from '../../utils'

const outputLabels: Record<OutputType, string> = { questions: '题目', practice_set: '练习集', exam: '试卷', score: '评分', answer_explanation: '答案解析', learning_report: '学习报告', mistake_set: '错题集', flashcards: '闪卡' }

export function IntentEditor({ value, onChange }: { value: ComparisonIntent; onChange: (value: ComparisonIntent) => void }) {
  function replace<K extends 'targetUsers' | 'useScenarios' | 'inputs' | 'practiceFormats' | 'outputs'>(key: K, item: ComparisonIntent[K][number] | '') {
    onChange({ ...value, [key]: item ? [item] : [] })
  }
  return (
    <div className="intent-editor stack">
      <div className="intent-original"><span className="eyebrow">原始文本（始终保留）</span><blockquote>{value.originalQuery || '未输入'}</blockquote></div>
      <div className="intent-fields">
        <label className="field"><span className="field__label">目标用户</span><select className="input" value={value.targetUsers[0] ?? ''} onChange={(e) => replace('targetUsers', e.target.value as TargetUser)}><option value="">未知／手动选择</option>{targetUsers.map((item) => <option key={item} value={item}>{targetUserLabels[item]}</option>)}</select></label>
        <label className="field"><span className="field__label">使用场景</span><select className="input" value={value.useScenarios[0] ?? ''} onChange={(e) => replace('useScenarios', e.target.value as UseScenario)}><option value="">未知／手动选择</option>{useScenarios.map((item) => <option key={item} value={item}>{scenarioLabels[item]}</option>)}</select></label>
        <label className="field"><span className="field__label">主要输入</span><select className="input" value={value.inputs[0] ?? ''} onChange={(e) => replace('inputs', e.target.value as InputType)}><option value="">未知／手动选择</option>{inputTypes.map((item) => <option key={item} value={item}>{inputTypeLabels[item]}</option>)}</select></label>
        <label className="field"><span className="field__label">练习形式</span><select className="input" value={value.practiceFormats[0] ?? ''} onChange={(e) => replace('practiceFormats', e.target.value as PracticeFormat)}><option value="">未知／手动选择</option>{practiceFormats.map((item) => <option key={item} value={item}>{practiceFormatLabels[item]}</option>)}</select></label>
        <label className="field"><span className="field__label">主要输出</span><select className="input" value={value.outputs[0] ?? ''} onChange={(e) => replace('outputs', e.target.value as OutputType)}><option value="">未知／手动选择</option>{outputTypes.map((item) => <option key={item} value={item}>{outputLabels[item]}</option>)}</select></label>
      </div>
    </div>
  )
}
