/* eslint-disable no-console */
async function newRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// CRC32 implementation for computing checksum headers expected by some S3-compatible backends
const CRC32_TABLE = (() => {
  const tbl = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    tbl[n] = c >>> 0
  }
  return tbl
})()

function crc32(buf) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) c = CRC32_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

function crc32Base64(buf) {
  const v = crc32(buf)
  const b = Buffer.alloc(4)
  b.writeUInt32BE(v, 0)
  return b.toString('base64')
}

async function uploadIfNeeded(baseUrl, jwt, sizeBytes, contentType) {
  const objectKeyEnv = process.env.OBJECT_KEY
  if (objectKeyEnv) return objectKeyEnv

  const requestId = await newRequestId()
  const headers = {
    'content-type': 'application/json',
    'X-Request-Id': requestId,
    ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
  }

  console.log(JSON.stringify({ level: 'info', message: 'presign_upload_request', requestId, baseUrl, contentType, sizeBytes }))
  const res = await fetch(`${baseUrl}/api/v1/storage/audio/presign`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ contentType, sizeBytes, filename: 'utterance.webm' }),
  })
  const body = await res.json().catch(() => ({}))
  console.log(JSON.stringify({ level: 'info', message: 'presign_upload_response', requestId, status: res.status, body }))
  if (!res.ok) throw new Error(`Upload presign failed: ${res.status}`)

  if (typeof body?.url === 'string' && !body.url.includes('example.local')) {
    const putHeaders = { 'Content-Type': contentType, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' }
    // Compute checksum if algorithm is indicated in query params
    let algo = null
    try {
      const u = new URL(body.url)
      algo = (u.searchParams.get('x-amz-sdk-checksum-algorithm') || '').toUpperCase()
    } catch {}
    const buf = new Uint8Array(sizeBytes)
    for (let i = 0; i < buf.length; i++) buf[i] = i % 255
    if (algo === 'CRC32') putHeaders['x-amz-checksum-crc32'] = crc32Base64(buf)

    const put = await fetch(body.url, { method: 'PUT', headers: putHeaders, body: buf })
    const putText = await put.text().catch(() => '')
    console.log(JSON.stringify({ level: 'info', message: 'upload_response', requestId, status: put.status, body: putText }))
    if (!put.ok) throw new Error(`Upload failed: ${put.status}`)
  } else {
    console.log(JSON.stringify({ level: 'info', message: 'upload_skipped_mock_mode', requestId }))
  }

  return body.objectKey
}

async function main() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  const jwt = process.env.AUTH_BEARER
  const sizeBytes = Number(process.env.SIZE_BYTES || '65536')
  const contentType = process.env.CONTENT_TYPE || 'audio/webm'

  const objectKey = await uploadIfNeeded(baseUrl, jwt, sizeBytes, contentType)

  const requestId = await newRequestId()
  const headers = {
    'X-Request-Id': requestId,
    ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
  }

  const qs = new URLSearchParams({ objectKey })
  console.log(JSON.stringify({ level: 'info', message: 'presign_download_request', requestId, objectKey }))
  const res = await fetch(`${baseUrl}/api/v1/storage/audio/presign?${qs.toString()}`, { method: 'GET', headers })
  const body = await res.json().catch(() => ({}))
  console.log(JSON.stringify({ level: 'info', message: 'presign_download_response', requestId, status: res.status, body }))
  if (!res.ok) process.exit(1)

  if (typeof body?.url === 'string' && !body.url.includes('example.local')) {
    const getRes = await fetch(body.url, { method: 'GET' })
    const arr = new Uint8Array(await getRes.arrayBuffer().catch(() => new ArrayBuffer(0)))
    console.log(JSON.stringify({ level: 'info', message: 'download_response', requestId, status: getRes.status, bytes: arr.length }))
    if (!getRes.ok) process.exit(1)
  } else {
    console.log(JSON.stringify({ level: 'info', message: 'download_skipped_mock_mode', requestId }))
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
