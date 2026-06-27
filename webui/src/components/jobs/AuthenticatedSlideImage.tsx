import { useEffect, useState } from 'react'

async function fetchSlideBlob(url: string): Promise<Blob> {
  const maxAttempts = 3
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const r = await fetch(url, { credentials: 'same-origin' })
    if (r.ok) return r.blob()
    if (r.status === 401 && attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)))
      continue
    }
    throw new Error(`${r.status}`)
  }
  throw new Error('failed to load slide')
}

export function AuthenticatedSlideImage({
  url,
  alt,
  className = '',
  loading = 'lazy' as 'lazy' | 'eager',
}: {
  url: string | null | undefined
  alt: string
  className?: string
  loading?: 'lazy' | 'eager'
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!url) {
      setBlobUrl(null)
      setFailed(true)
      return undefined
    }

    let active = true
    let objectUrl: string | null = null
    setBlobUrl(null)
    setFailed(false)

    fetchSlideBlob(url)
      .then((blob) => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setBlobUrl(objectUrl)
      })
      .catch(() => {
        if (active) setFailed(true)
      })

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])

  if (!url || failed) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-800/40 text-[10px] text-white/50 ${className}`}
        aria-hidden
      >
        无预览
      </div>
    )
  }

  if (!blobUrl) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-800/20 text-[10px] text-white/40 ${className}`}
        aria-hidden
      >
        …
      </div>
    )
  }

  return (
    <img
      src={blobUrl}
      alt={alt}
      className={className}
      loading={loading}
    />
  )
}
