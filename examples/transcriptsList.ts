// @ts-nocheck
import { ensureRequestId, log } from './requestId'

async function main() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  const jwt = process.env.AUTH_BEARER
  const sessionId = process.env.SESSION_ID || 'sess_local'
  const headers: Record<string, string> = {}
  if (jwt) headers['authorization'] = `Bearer ${jwt}`
  const { headers: h, requestId } = ensureRequestId(headers)
  const url = `${baseUrl}/api/v1/transcripts?sessionId=${encodeURIComponent(sessionId)}&limit=20`
  log('info', 'transcripts_request', { requestId, url })
  const res = await fetch(url, { headers: h })
  const text = await res.text()
  log('info', 'transcripts_response', { requestId, status: res.status, body: text })
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
