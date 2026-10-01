import { useId } from 'react'
import { Tag } from '../ui'

export interface MatchExplanationProps {
  reasons: readonly string[]
}

export function MatchExplanation({ reasons }: MatchExplanationProps) {
  const headingId = useId()

  return (
    <section className="discovery-reasons" aria-labelledby={headingId}>
      <h2 id={headingId}>为什么匹配</h2>
      {reasons.length ? (
        <div className="discovery-reasons__tags cluster">
          {reasons.map((reason, index) => <Tag key={`${reason}-${index}`}>{reason}</Tag>)}
        </div>
      ) : null}
    </section>
  )
}
