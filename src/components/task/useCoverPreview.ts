import { useEffect, useState } from 'react'

/** A display-only URL. Never persisted or sent to a service. */
export function useCoverPreview(file: File | null) {
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null)
  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== 'function') {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview({ file, url })
    return () => URL.revokeObjectURL(url)
  }, [file])
  return preview?.file === file ? preview?.url : undefined
}
