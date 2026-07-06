import { useAuthStore } from '../stores/authStore'

export type ExternalLoginResult = 'success' | 'failed' | 'absent'

interface ExternalLoginPayload {
  phone: string
  password: string
}

const ACCOUNT_SUFFIX = '@sjsk'

function stripCodeParam() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('code')) return
  url.searchParams.delete('code')
  const qs = url.searchParams.toString()
  const next = `${url.pathname}${qs ? `?${qs}` : ''}${url.hash}`
  window.history.replaceState({}, '', next)
}

/**
 * Attempt an external-system auto-login.
 *
 * Reads `?code=<base64>` from the current URL, decodes the base64 JSON
 * payload (`{ phone, password }`), and logs the user in as
 * `<phone>@sjsk` / `<password>`. The `code` parameter is stripped from
 * the URL regardless of outcome so that a page refresh does not replay
 * the attempt.
 *
 * Returns:
 *   - `'success'` — login succeeded; the user is now authenticated.
 *   - `'failed'`  — code was present but the payload was malformed or
 *                   login was rejected. Caller should send the user to
 *                   the manual login page.
 *   - `'absent'`  — no `code` parameter; nothing to do.
 */
export async function attemptExternalLogin(): Promise<ExternalLoginResult> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  if (!code) return 'absent'

  let payload: ExternalLoginPayload
  try {
    const decoded = atob(code)
    const parsed = JSON.parse(decoded) as Partial<ExternalLoginPayload>
    if (typeof parsed.phone !== 'string' || typeof parsed.password !== 'string') {
      stripCodeParam()
      return 'failed'
    }
    payload = { phone: parsed.phone, password: parsed.password }
  } catch {
    stripCodeParam()
    return 'failed'
  }

  try {
    await useAuthStore.getState().login(`${payload.phone}${ACCOUNT_SUFFIX}`, payload.password)
    stripCodeParam()
    return 'success'
  } catch {
    stripCodeParam()
    return 'failed'
  }
}