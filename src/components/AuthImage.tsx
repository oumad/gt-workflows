import { useState, useEffect, useRef } from 'react'
import { fetchWithAuth } from '../utils/auth'
import './AuthImage.css'

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
 * Use this instead of <img src="/data/..."> when auth is required, since img cannot send headers.
 */
export default function AuthImage({ workflowName, iconPath, alt, className, version, onError }: AuthImageProps) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const blobUrlRef = useRef<string | null>(null)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const normalizedPath = iconPath.replace(/^\.\//, '')
  const url = `/api/workflows/${encodeURIComponent(workflowName)}/file/${encodeURIComponent(normalizedPath)}${version != null ? `?v=${version}` : ''}`

  useEffect(() => {
    let cancelled = false
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
        blobUrlRef.current = blobUrl
        setSrc(blobUrl)
      } catch {
        if (!cancelled) {
          setError(true)
          onErrorRef.current?.()
        }
      }
    })()
    return () => {
      cancelled = true
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
      setSrc(null)
    }
  }, [url])

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
