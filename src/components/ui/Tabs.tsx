export interface TabItem<T extends string> {
  id: T
  label: string
}

export interface TabsProps<T extends string> {
  label: string
  items: readonly TabItem<T>[]
  value: T
  onChange: (value: T) => void
}

export function Tabs<T extends string>({ label, items, value, onChange }: TabsProps<T>) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === value}
          className="tabs__tab"
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
