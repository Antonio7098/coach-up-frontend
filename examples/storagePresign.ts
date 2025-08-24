// @ts-nocheck
import { ensureRequestId, log } from './requestId'

async function main() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  const jwt = process.env.AUTH_BEARER
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (jwt) headers['authorization'] = `Bearer ${jwt}`
  const { headers: h, requestId } = ensureRequestId(headers)
  const body = { contentType: process.env.CONTENT_TYPE || 'audio/webm', filename: 'utterance.webm', sizeBytes: 102400 }
  log('info', 'presign_request', { requestId, baseUrl, body })
  const res = await fetch(`${baseUrl}/api/v1/storage/audio/presign`, { method: 'POST', headers: h, body: JSON.stringify(body) })
  const text = await res.text()
  log('info', 'presign_response', { requestId, status: res.status, body: text })
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
