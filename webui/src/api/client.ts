let onUnauthorized: (() => void) | null = null

export function setOnUnauthorized(handler: () => void) {
  onUnauthorized = handler
}

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: FormData | Record<string, unknown> | null,
): Promise<T> {
  const opt: RequestInit = { method, credentials: 'same-origin', headers: {} }
  if (body instanceof FormData) {
    opt.body = body
  } else if (body !== undefined && body !== null) {
    ;(opt.headers as Record<string, string>)['Content-Type'] = 'application/json'
    opt.body = JSON.stringify(body)
  }

  const r = await fetch(path, opt)

  if (r.status === 401) {
    onUnauthorized?.()
    const text = await r.text().catch(() => '')
    throw new Error(`401: ${text}`)
  }

  if (!r.ok) {
    let text = ''
    try {
      text = await r.text()
    } catch {
      /* ignore */
    }
    throw new Error(`${r.status}: ${text}`)
  }

  const ct = r.headers.get('content-type') || ''
  if (ct.includes('application/json')) return r.json() as Promise<T>
  return r.text() as Promise<T>
}

export function downloadUrl(path: string, filename?: string) {
  const a = document.createElement('a')
  a.href = path
  if (filename) a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
