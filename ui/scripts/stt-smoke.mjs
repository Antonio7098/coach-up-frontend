/* eslint-disable no-console */
async function newRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

async function main() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  const jwt = process.env.AUTH_BEARER
  const sessionId = process.env.SESSION_ID || 'sess_local'
  const groupId = process.env.GROUP_ID || 'grp_local'
  const audioUrl = process.env.AUDIO_URL || 'https://example.com/audio/mock.wav'
  const objectKey = process.env.OBJECT_KEY // optional alternative to audioUrl

  const requestId = await newRequestId()
  const headers = {
    'X-Request-Id': requestId,
    'Content-Type': 'application/json',
    ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
  }

  const url = `${baseUrl}/api/v1/stt`
  const body = JSON.stringify({ audioUrl, objectKey, sessionId, groupId })
  console.log(JSON.stringify({ level: 'info', message: 'stt_request', requestId, url, body }))
  const res = await fetch(url, { method: 'POST', headers, body })
  const text = await res.text()
  console.log(JSON.stringify({ level: 'info', message: 'stt_response', requestId, status: res.status, body: text }))
  if (!res.ok) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
