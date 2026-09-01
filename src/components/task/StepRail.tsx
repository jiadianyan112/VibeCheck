import type { MouseEvent } from 'react'

export type TaskStepState = 'complete' | 'current' | 'upcoming'

export interface TaskStepItem {
  id: string
  label: string
  state: TaskStepState
}

export interface StepRailProps {
  steps: readonly TaskStepItem[]
  onStepSelect?: (step: TaskStepItem) => void
  ariaLabel?: string
  className?: string
}

function handleStepClick(
  event: MouseEvent<HTMLButtonElement>,
  step: TaskStepItem,
  onStepSelect: ((step: TaskStepItem) => void) | undefined,
) {
  event.preventDefault()
  onStepSelect?.(step)
}

export function StepRail({
  steps,
  onStepSelect,
  ariaLabel = '任务步骤',
  className = '',
}: StepRailProps) {
  const rootClassName = ['task-step-rail', className].filter(Boolean).join(' ')

  return (
    <nav className={rootClassName} aria-label={ariaLabel}>
      <ol className="task-step-rail__list" tabIndex={0} aria-label={`${ariaLabel}，可横向滚动`}>
        {steps.map((step, index) => {
          const itemClassName = [
            'task-step-rail__item',
            `task-step-rail__item--${step.state}`,
          ].join(' ')
          const isSelectable = Boolean(onStepSelect) && step.state !== 'upcoming'

          return (
            <li
              key={step.id}
              className={itemClassName}
              data-step-id={step.id}
              data-step-state={step.state}
              aria-current={step.state === 'current' ? 'step' : undefined}
              aria-posinset={index + 1}
              aria-setsize={steps.length}
            >
              {isSelectable ? (
                <button
                  type="button"
                  className="task-step-rail__button"
                  onClick={(event) => handleStepClick(event, step, onStepSelect)}
                >
                  {step.label}
                </button>
              ) : (
                <span className="task-step-rail__label">{step.label}</span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
