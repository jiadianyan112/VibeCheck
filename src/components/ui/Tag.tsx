import type { HTMLAttributes, ReactNode } from 'react'

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'default' | 'strong' | 'dashed'
  children: ReactNode
}

export function Tag({ tone = 'default', children, className = '', ...props }: TagProps) {
  return (
    <span
      className={`tag ${tone === 'default' ? '' : `tag--${tone}`} ${className}`.trim()}
      {...props}
    >
      {children}
    </span>
  )
}
