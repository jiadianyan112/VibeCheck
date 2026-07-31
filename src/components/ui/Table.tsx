import type { ReactNode } from 'react'

export interface TableColumn<Row> {
  key: string
  header: string
  render: (row: Row) => ReactNode
  rowHeader?: boolean
}

export interface TableProps<Row> {
  label: string
  columns: readonly TableColumn<Row>[]
  rows: readonly Row[]
  getRowKey: (row: Row) => string
  emptyMessage?: string
}

export function Table<Row>({
  label,
  columns,
  rows,
  getRowKey,
  emptyMessage = '暂无数据',
}: TableProps<Row>) {
  if (rows.length === 0) return <div className="empty-state">{emptyMessage}</div>

  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={`${label}，可横向滚动`}>
      <table className="wire-table">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((column) =>
                column.rowHeader ? (
                  <th key={column.key} scope="row">
                    {column.render(row)}
                  </th>
                ) : (
                  <td key={column.key}>{column.render(row)}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
