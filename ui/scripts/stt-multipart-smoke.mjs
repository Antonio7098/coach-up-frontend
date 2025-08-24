/* eslint-disable no-console */
async function newRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function makeWavBuffer({ sampleRate = 8000, durationSec = 0.2, channels = 1, bitsPerSample = 16 } = {}) {
  const samples = Math.floor(sampleRate * durationSec)
  const dataSize = samples * channels * (bitsPerSample / 8)
  const buf = Buffer.alloc(44 + dataSize)
  // RIFF header
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  // fmt chunk
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16) // PCM chunk size
  buf.writeUInt16LE(1, 20) // PCM format
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28)
  buf.writeUInt16LE(channels * (bitsPerSample / 8), 32)
  buf.writeUInt16LE(bitsPerSample, 34)
  // data chunk
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  // we keep PCM bytes zeroed (silence)
  return buf
}

async function main() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  const jwt = process.env.AUTH_BEARER
  const sessionId = process.env.SESSION_ID || 'sess_local'
  const groupId = process.env.GROUP_ID || 'grp_local'
  const languageHint = process.env.LANGUAGE_HINT || 'en'

  const requestId = await newRequestId()
  const wav = makeWavBuffer()
  const blob = new Blob([wav], { type: 'audio/wav' })

  const form = new FormData()
  form.append('audio', blob, 'sample.wav')
  form.append('languageHint', languageHint)
  form.append('sessionId', sessionId)
  form.append('groupId', groupId)

  const headers = {
    'X-Request-Id': requestId,
    ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
  }

  const url = `${baseUrl}/api/v1/stt`
  console.log(JSON.stringify({ level: 'info', message: 'stt_multipart_request', requestId, url, fields: ['audio','languageHint','sessionId','groupId'] }))
  const res = await fetch(url, { method: 'POST', headers, body: form })
  const text = await res.text()
  console.log(JSON.stringify({ level: 'info', message: 'stt_multipart_response', requestId, status: res.status, body: text }))
  if (!res.ok) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
