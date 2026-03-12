import { useState, useEffect, useRef } from 'react'
import { fetchWithAuth } from '@/utils/auth'
import { useAuth } from '@/features/auth'
import './AuthImage.css'

/** Module-level cache: url → blob URL. Entries persist for the lifetime of the page. */
const imageCache = new Map<string, string>()

interface AuthImageProps {
  workflowName: string
  iconPath: string
  alt: string
  className?: string
  /** Optional cache-busting query (e.g. iconVersion) */
  version?: number | string
  onError?: () => void
}

/**
 * Displays a workflow image (e.g. icon) by fetching it with auth and showing a blob URL.
 * Uses a module-level cache to avoid re-fetching the same image on remount.
 * Use this instead of <img src="/data/..."> when auth is required, since img cannot send headers.
 */
export default function AuthImage({ workflowName, iconPath, alt, className, version, onError }: AuthImageProps) {
  const { authStatus } = useAuth()
  const normalizedPath = iconPath.replace(/^\.\//, '')
  const url = `/api/workflows/${encodeURIComponent(workflowName)}/file/${encodeURIComponent(normalizedPath)}${version != null ? `?v=${version}` : ''}`

  const [src, setSrc] = useState<string | null>(() => imageCache.get(url) ?? null)
  const [error, setError] = useState(false)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    if (authStatus !== 'ok') return

    const cached = imageCache.get(url)
    if (cached) {
      setSrc(cached)
      setError(false)
      return
    }

    let cancelled = false
    setSrc(null)
    setError(false)

    ;(async () => {
      try {
        const res = await fetchWithAuth(url)
        if (cancelled) return
        if (!res.ok) {
          setError(true)
          if (!cancelled) onErrorRef.current?.()
          return
        }
        const blob = await res.blob()
        if (cancelled) return
        const blobUrl = URL.createObjectURL(blob)
        imageCache.set(url, blobUrl)
        setSrc(blobUrl)
      } catch {
        if (!cancelled) {
          setError(true)
          onErrorRef.current?.()
        }
      }
    })()

    return () => { cancelled = true }
  }, [url, authStatus])

  if (error) {
    return null
  }
  return (
    <div className="auth-image-wrap">
      {!src ? (
        <span className="auth-image-spinner" aria-hidden />
      ) : (
        <img src={src} alt={alt} className={className} />
      )}
    </div>
  )
}
