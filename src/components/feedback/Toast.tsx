import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'

interface ToastMessage { id: string; message: string; tone: 'info' | 'success' | 'error' }
interface ToastContextValue { pushToast: (message: string, tone?: ToastMessage['tone']) => void }

const ToastContext = createContext<ToastContextValue | null>(null)
let nextToastId = 0

export function ToastProvider({ children }: PropsWithChildren) {
  const [messages, setMessages] = useState<ToastMessage[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => () => {
    timers.current.forEach(clearTimeout)
    timers.current.clear()
  }, [])
  const dismissToast = useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (timer) clearTimeout(timer)
    timers.current.delete(id)
    setMessages((current) => current.filter((item) => item.id !== id))
  }, [])
  const pushToast = useCallback((message: string, tone: ToastMessage['tone'] = 'info') => {
    const id = `toast-${++nextToastId}`
    setMessages((current) => [...current, { id, message, tone }].slice(-3))
    timers.current.set(id, setTimeout(() => dismissToast(id), tone === 'error' ? 8000 : 5000))
  }, [dismissToast])
  const value = useMemo(() => ({ pushToast }), [pushToast])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <section className="toast-region" aria-live="polite" aria-label="操作反馈">
        {messages.map((item) => (
          <div key={item.id} className={`toast toast--${item.tone}`} role={item.tone === 'error' ? 'alert' : 'status'}>
            <span className="toast__message">{item.message}</span>
            <button className="toast__dismiss" type="button" aria-label="关闭提示" onClick={() => dismissToast(item.id)}>×</button>
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
