/*
  TTS Provider interfaces and registry
*/
import crypto from 'node:crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

export type TtsInput = {
  text: string
  voiceId?: string | null
  format?: string | null
}

// AWS Polly TTS
const awsTts: TtsProvider = {
  name: 'aws',
  async synthesize(input: TtsInput): Promise<TtsResult> {
    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || process.env.S3_REGION || 'us-east-1'
    const endpoint = process.env.AWS_ENDPOINT_URL // for LocalStack compatibility (optional)
    // Lazy load SDK
    const mod: any = await import('@aws-sdk/client-polly')
    const PollyClient = mod.PollyClient
    const SynthesizeSpeechCommand = mod.SynthesizeSpeechCommand
    if (!PollyClient || !SynthesizeSpeechCommand) throw new Error('AWS Polly SDK not available')

    let { contentType, ext } = pickFormat(input.format)
    // Map to Polly OutputFormat
    let outputFormat: 'mp3' | 'ogg_vorbis' | 'pcm' = 'mp3'
    if (ext === 'ogg') outputFormat = 'ogg_vorbis'
    else if (ext === 'wav') {
      // Polly cannot return WAV directly; use PCM and label as WAV is incorrect. Switch to mp3.
      outputFormat = 'mp3'
      contentType = 'audio/mpeg'
      ext = 'mp3'
    } else if (ext === 'm4a') {
      // Not supported, map to mp3
      outputFormat = 'mp3'
      contentType = 'audio/mpeg'
      ext = 'mp3'
    }

    const voiceId = input.voiceId || process.env.TTS_VOICE_ID || 'Joanna'
    const engine = (process.env.AWS_POLLY_ENGINE || 'standard') as 'standard' | 'neural'

    const client = new PollyClient({ region, ...(endpoint ? { endpoint } : {}) })
    const out = await client.send(
      new SynthesizeSpeechCommand({
        OutputFormat: outputFormat,
        Text: input.text,
        VoiceId: voiceId,
        Engine: engine,
      }),
    )

    const u8 = await toUint8(out.AudioStream)

    const s3Url = await uploadToS3(u8, contentType)
    if (s3Url) {
      return { provider: 'aws', audioUrl: s3Url, format: contentType, voiceId }
    }
    const b64 = Buffer.from(u8).toString('base64')
    const dataUrl = `data:${contentType};base64,${b64}`
    return { provider: 'aws', audioUrl: dataUrl, format: contentType, voiceId }
  },
}

async function toUint8(body: any): Promise<Uint8Array> {
  if (!body) return new Uint8Array()
  if (body instanceof Uint8Array) return body
  if (typeof body.transformToByteArray === 'function') return (await body.transformToByteArray()) as Uint8Array
  if (typeof body.arrayBuffer === 'function') return new Uint8Array(await body.arrayBuffer())
  const chunks: Buffer[] = []
  try {
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
  } catch {}
  return new Uint8Array(Buffer.concat(chunks))
}

export type TtsResult = {
  provider: string
  audioUrl: string
  format: string
  voiceId?: string
  note?: string
}

export class ProviderNotConfiguredError extends Error {
  status = 501 as const
  constructor(message = 'TTS provider not configured') {
    super(message)
    this.name = 'ProviderNotConfiguredError'
  }
}

export interface TtsProvider {
  name: string
  synthesize(input: TtsInput): Promise<TtsResult>
}

// Mock provider
const mockTts: TtsProvider = {
  name: 'mock',
  async synthesize(input: TtsInput): Promise<TtsResult> {
    const fmt = input.format || 'audio/mpeg'
    const ext = fmt.includes('wav') ? 'wav' : 'mp3'
    const url = `https://example.com/tts/mock/${encodeURIComponent(input.text.slice(0, 24))}.${ext}`
    return {
      provider: 'mock',
      audioUrl: url,
      format: fmt,
      voiceId: input.voiceId ?? undefined,
      note: 'mock provider — no real audio produced',
    }
  },
}

// Google Cloud Text-to-Speech integration
const googleTts: TtsProvider = {
  name: 'google',
  async synthesize(input: TtsInput): Promise<TtsResult> {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_CLOUD_PROJECT) {
      throw new ProviderNotConfiguredError('Google Cloud ADC not configured (set GOOGLE_APPLICATION_CREDENTIALS)')
    }
    let { contentType, ext } = pickFormat(input.format)
    // Map to Google AudioEncoding
    type AudioEncoding = 'MP3' | 'LINEAR16' | 'OGG_OPUS'
    let audioEncoding: AudioEncoding = 'MP3'
    if (ext === 'wav') audioEncoding = 'LINEAR16'
    else if (ext === 'ogg') audioEncoding = 'OGG_OPUS'
    else if (ext === 'm4a') {
      // Google TTS does not support MP4/M4A container. Produce MP3 instead.
      audioEncoding = 'MP3'
      contentType = 'audio/mpeg'
      ext = 'mp3'
    } else if (ext === 'mp3') {
      audioEncoding = 'MP3'
    } else {
      throw new Error(`Unsupported TTS format for Google: ${contentType}`)
    }

    // Lazy-load SDK to avoid bundling when not used
    const pkg = '@google-cloud/text-to-speech'
    const mod: any = await import(pkg as string)
    const TextToSpeechClient = mod.TextToSpeechClient || mod.default?.TextToSpeechClient
    if (!TextToSpeechClient) throw new Error('Google TTS SDK not available')
    const client = new TextToSpeechClient()
    const languageCode = process.env.GOOGLE_TTS_LANGUAGE || 'en-US'
    const voiceName = input.voiceId || process.env.GOOGLE_TTS_VOICE || undefined

    const [resp] = await client.synthesizeSpeech({
      input: { text: input.text },
      voice: {
        languageCode,
        ...(voiceName ? { name: voiceName } : {}),
      },
      audioConfig: {
        audioEncoding: audioEncoding as any,
      },
    })
    const buf = resp.audioContent instanceof Buffer ? resp.audioContent : Buffer.from(resp.audioContent as any)
    const u8 = new Uint8Array(buf)

    const s3Url = await uploadToS3(u8, contentType)
    if (s3Url) {
      return { provider: 'google', audioUrl: s3Url, format: contentType, voiceId: voiceName }
    }
    const b64 = Buffer.from(u8).toString('base64')
    const dataUrl = `data:${contentType};base64,${b64}`
    return { provider: 'google', audioUrl: dataUrl, format: contentType, voiceId: voiceName }
  },
}

// Azure Cognitive Services Text-to-Speech integration (REST)
const azureTts: TtsProvider = {
  name: 'azure',
  async synthesize(input: TtsInput): Promise<TtsResult> {
    const key = process.env.AZURE_SPEECH_KEY
    const region = process.env.AZURE_SPEECH_REGION
    if (!key || !region) {
      throw new ProviderNotConfiguredError('AZURE_SPEECH_KEY and AZURE_SPEECH_REGION are required')
    }

    let { contentType, ext } = pickFormat(input.format)
    // Azure does not support m4a container for output; map to mp3
    if (ext === 'm4a') {
      contentType = 'audio/mpeg'
      ext = 'mp3'
    }

    // Map to Azure output format header
    // See: https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech#audio-outputs
    let azureOutput = 'audio-24khz-160kbitrate-mono-mp3'
    if (ext === 'mp3') azureOutput = 'audio-24khz-160kbitrate-mono-mp3'
    else if (ext === 'wav') azureOutput = 'riff-16khz-16bit-mono-pcm'
    else if (ext === 'ogg') azureOutput = 'ogg-24khz-16bit-mono-opus'
    else throw new Error(`Unsupported TTS format for Azure: ${contentType}`)

    const languageCode = process.env.AZURE_TTS_LANGUAGE || process.env.GOOGLE_TTS_LANGUAGE || 'en-US'
    const voiceName = input.voiceId || process.env.AZURE_TTS_VOICE || undefined

    const endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`
    const ssml = `<?xml version="1.0" encoding="UTF-8"?>\n<speak version="1.0" xml:lang="${languageCode}">\n  <voice xml:lang="${languageCode}" ${voiceName ? `name="${voiceName}"` : ''}>${escapeXml(
      input.text,
    )}</voice>\n</speak>`

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': azureOutput,
        'User-Agent': 'coach-up-ui/tts',
      },
      body: ssml,
    })
    if (!res.ok) {
      const t = await res.text()
      throw new Error(`Azure TTS HTTP ${res.status}: ${t}`)
    }
    const ab = await res.arrayBuffer()
    const u8 = new Uint8Array(ab)

    const s3Url = await uploadToS3(u8, contentType)
    if (s3Url) {
      return { provider: 'azure', audioUrl: s3Url, format: contentType, voiceId: voiceName }
    }
    const b64 = Buffer.from(u8).toString('base64')
    const dataUrl = `data:${contentType};base64,${b64}`
    return { provider: 'azure', audioUrl: dataUrl, format: contentType, voiceId: voiceName }
  },
}

// Helpers
function pickFormat(fmt?: string | null): { contentType: string; ext: string } {
  const f = (fmt || '').toLowerCase()
  if (f.includes('wav')) return { contentType: 'audio/wav', ext: 'wav' }
  if (f.includes('ogg')) return { contentType: 'audio/ogg', ext: 'ogg' }
  if (f.includes('mp4') || f.includes('m4a')) return { contentType: 'audio/mp4', ext: 'm4a' }
  return { contentType: 'audio/mpeg', ext: 'mp3' }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

async function uploadToS3(data: Uint8Array, contentType: string): Promise<string | null> {
  const bucket = process.env.S3_BUCKET_AUDIO
  if (!bucket) return null
  const region = process.env.S3_REGION || 'us-east-1'
  const endpoint = process.env.S3_ENDPOINT_URL
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === '1'
  const s3 = new S3Client({ region, ...(endpoint ? { endpoint } : {}), forcePathStyle })
  const date = new Date()
  const day = date.toISOString().slice(0, 10)
  const ext = contentType.includes('wav') ? 'wav' : contentType.includes('ogg') ? 'ogg' : contentType.includes('mp4') ? 'm4a' : 'mp3'
  const key = `tts/${day}/${crypto.randomUUID()}.${ext}`
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: contentType }))
  // Construct a URL if endpoint is public-ish; otherwise caller will know to use bucket access. For LocalStack/minio, endpoint works.
  if (endpoint) {
    const base = endpoint.replace(/\/$/, '')
    const pathStyle = forcePathStyle
    return pathStyle ? `${base}/${bucket}/${key}` : `${base}/${key}`
  }
  return `s3://${bucket}/${key}`
}

// OpenAI TTS integration
const openaiTts: TtsProvider = {
  name: 'openai',
  async synthesize(input: TtsInput): Promise<TtsResult> {
    const key = process.env.OPENAI_API_KEY
    if (!key) throw new ProviderNotConfiguredError('OPENAI_API_KEY is missing')
    const { contentType, ext } = pickFormat(input.format)
    const model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts'
    const voice = input.voiceId || process.env.TTS_VOICE_ID || 'alloy'

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: input.text,
        voice,
        format: ext === 'mp3' ? 'mp3' : ext, // openai expects 'mp3'|'wav'|'ogg'|'pcm'
      }),
    })
    if (!res.ok) {
      const t = await res.text()
      throw new Error(`OpenAI TTS HTTP ${res.status}: ${t}`)
    }
    const ab = await res.arrayBuffer()
    const u8 = new Uint8Array(ab)

    // Try S3 upload when configured
    const s3Url = await uploadToS3(u8, contentType)
    if (s3Url) {
      return { provider: 'openai', audioUrl: s3Url, format: contentType, voiceId: voice }
    }
    // Fallback to data URL
    const b64 = Buffer.from(u8).toString('base64')
    const dataUrl = `data:${contentType};base64,${b64}`
    return { provider: 'openai', audioUrl: dataUrl, format: contentType, voiceId: voice }
  },
}

export function getTtsProvider(name?: string): TtsProvider {
  const id = (name || process.env.TTS_PROVIDER || 'mock').toLowerCase()
  switch (id) {
    case 'aws':
    case 'polly':
      return awsTts
    case 'azure':
      return azureTts
    case 'google':
      return googleTts
    case 'openai':
      return openaiTts
    case 'mock':
    default:
      return mockTts
  }
}
