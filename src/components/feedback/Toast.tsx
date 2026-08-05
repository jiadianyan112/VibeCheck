import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react'

interface ToastMessage { id: string; message: string; tone: 'info' | 'success' | 'error' }
interface ToastContextValue { pushToast: (message: string, tone?: ToastMessage['tone']) => void }

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: PropsWithChildren) {
  const [messages, setMessages] = useState<ToastMessage[]>([])
  const pushToast = useCallback((message: string, tone: ToastMessage['tone'] = 'info') => {
    const id = `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`
    setMessages((current) => [...current, { id, message, tone }].slice(-3))
  }, [])
  const value = useMemo(() => ({ pushToast }), [pushToast])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <section className="toast-region" aria-live="polite" aria-label="操作反馈">
        {messages.map((item) => (
          <div key={item.id} className={`toast toast--${item.tone}`} role={item.tone === 'error' ? 'alert' : 'status'}>
            <span>{item.message}</span>
            <button type="button" aria-label="关闭提示" onClick={() => setMessages((current) => current.filter((message) => message.id !== item.id))}>×</button>
          </div>
        ))}
      </section>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}
