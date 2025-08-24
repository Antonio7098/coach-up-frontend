/* eslint-disable no-console */
async function newRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

async function main() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  const jwt = process.env.AUTH_BEARER
  const sessionId = process.env.SESSION_ID || 'sess_local'

  const requestId = await newRequestId()
  const headers = {
    'X-Request-Id': requestId,
    ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
  }

  const url = `${baseUrl}/api/v1/transcripts?sessionId=${encodeURIComponent(sessionId)}&limit=5`
  console.log(JSON.stringify({ level: 'info', message: 'transcripts_request', requestId, url }))
  const res = await fetch(url, { headers })
  const text = await res.text()
  console.log(JSON.stringify({ level: 'info', message: 'transcripts_response', requestId, status: res.status, body: text }))
  if (!res.ok) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
