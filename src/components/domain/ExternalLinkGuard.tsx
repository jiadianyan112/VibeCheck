import { useState, type ReactNode } from 'react'
import { Button, Modal } from '../ui'

export function ExternalLinkGuard({ href, children }: { href: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  let host = href
  try {
    host = new URL(href).host
  } catch {
    host = '无效地址'
  }

  return (
    <>
      <button type="button" className="external-link" onClick={() => setOpen(true)}>{children} ↗</button>
      <Modal
        open={open}
        title="即将离开 VibeCheck"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <a className="button button--primary" href={href} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>继续访问</a>
          </>
        }
      >
        <p>目标站点：{host}</p>
        <p className="page-description">外部内容与可用状态可能发生变化，请自行判断。</p>
      </Modal>
    </>
  )
}
