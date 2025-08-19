// Minimal Request ID helper and logger example for the frontend repo
// Use this to propagate X-Request-Id and produce structured logs.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export function newRequestId(): string {
  // Prefer Web Crypto API when available
  // Fallback to a simple timestamp-random string for environments without crypto
  const g: any = globalThis as any
  const uuid = g?.crypto?.randomUUID?.()
  if (uuid) return uuid
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function ensureRequestId(
  headers?: Record<string, string>
): { headers: Record<string, string>; requestId: string } {
  const out: Record<string, string> = { ...(headers || {}) }
  const existing = out['X-Request-Id'] || out['x-request-id']
  const requestId = existing || newRequestId()
  out['X-Request-Id'] = requestId
  return { headers: out, requestId }
}

export function log(level: LogLevel, message: string, fields: Record<string, any> = {}) {
  // Simple structured log. In production, route this to your logger of choice.
  const payload = { level, message, time: new Date().toISOString(), ...fields }
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    JSON.stringify(payload)
  )
}

// Example fetch wrapper that ensures and forwards X-Request-Id
export async function fetchWithRequestId(
  input: RequestInfo | URL,
  init: RequestInit = {},
  opts: { requestId?: string } = {}
) {
  const baseHeaders: Record<string, string> = {}
  if (init.headers && init.headers instanceof Headers) {
    init.headers.forEach((v, k) => {
      baseHeaders[k] = v
    })
  } else if (init.headers && typeof init.headers === 'object') {
    Object.assign(baseHeaders, init.headers as Record<string, string>)
  }

  const { headers, requestId } = ensureRequestId({ ...baseHeaders, ...(opts.requestId ? { 'X-Request-Id': opts.requestId } : {}) })

  log('info', 'outbound_request', { requestId, url: String(input) })

  const resp = await fetch(input, { ...init, headers })
  return resp
}
