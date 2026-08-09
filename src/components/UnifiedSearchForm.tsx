import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { unifiedSearchPath } from '../features/discovery/searchRouting'

interface UnifiedSearchFormProps {
  id: string
  className: string
  inputClassName: string
  submitClassName: string
  defaultValue?: string
  placeholder?: string
  submitLabel?: string
}

export function UnifiedSearchForm({
  id,
  className,
  inputClassName,
  submitClassName,
  defaultValue = '',
  placeholder = '搜索作品、功能，或输入完整想法',
  submitLabel = '搜索',
}: UnifiedSearchFormProps) {
  const navigate = useNavigate()

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    navigate(unifiedSearchPath(String(data.get('q') ?? '')))
  }

  return (
    <form className={className} role="search" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor={id}>搜索作品或输入完整想法</label>
      <input
        className={inputClassName}
        id={id}
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
      />
      <button className={submitClassName} type="submit">{submitLabel}</button>
    </form>
  )
}
