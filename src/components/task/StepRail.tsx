export type TaskStep = 'address' | 'prefill' | 'definition' | 'solution' | 'development' | 'preview'

const stages = [
  { step: 'address', id: 'address', label: '检查地址' },
  { step: 'prefill', id: 'details', label: '基础信息' },
  { step: 'definition', id: 'purpose', label: '定位与用途' },
  { step: 'solution', id: 'content', label: '核心内容' },
  { step: 'development', id: 'development', label: '开发与资产' },
  { step: 'preview', id: 'preview', label: '预览与提交' },
] as const

export function StepRail({ currentStep }: { currentStep: TaskStep }) {
  const activeIndex = stages.findIndex(({ step }) => step === currentStep)
  return <ol className="step-rail" aria-label="发布步骤">
    {stages.map(({ id, label }, index) => <li key={id} data-step-id={id}
      data-step-state={index === activeIndex ? 'current' : index < activeIndex ? 'complete' : 'upcoming'}
      aria-label={`${label}，${index === activeIndex ? '当前步骤' : index < activeIndex ? '已完成' : '后续步骤'}`}
      aria-current={index === activeIndex ? 'step' : undefined}>
      <span>{label}</span>
    </li>)}
  </ol>
}
