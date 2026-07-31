import { Button, Modal } from '../ui'

export function ConfirmDialog({ open, title, description, confirmLabel = '确认', danger = false, onConfirm, onCancel }: { open: boolean; title: string; description: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal open={open} title={title} onClose={onCancel} footer={<><Button onClick={onCancel}>取消</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button></>}>
      <p>{description}</p>
    </Modal>
  )
}
