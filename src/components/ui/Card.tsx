import type { HTMLAttributes, ReactNode } from 'react'

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'article' | 'section' | 'div'
  children: ReactNode
}

export function Card({ as: Element = 'article', children, className = '', ...props }: CardProps) {
  return (
    <Element className={`wire-card ${className}`.trim()} {...props}>
      {children}
    </Element>
  )
}
