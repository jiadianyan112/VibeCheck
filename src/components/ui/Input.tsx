import { forwardRef, useId, type InputHTMLAttributes } from 'react'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, id, className = '', ...props },
  ref,
) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const descriptionId = hint || error ? `${inputId}-description` : undefined

  return (
    <label className="field" htmlFor={inputId}>
      <span className="field__label">{label}</span>
      <input
        ref={ref}
        id={inputId}
        className={`input ${error ? 'input--error' : ''} ${className}`.trim()}
        aria-invalid={Boolean(error)}
        aria-describedby={descriptionId}
        {...props}
      />
      {error ? (
        <span id={descriptionId} className="field__error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={descriptionId} className="field__hint">
          {hint}
        </span>
      ) : null}
    </label>
  )
})
