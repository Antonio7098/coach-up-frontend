/*
  STT Provider interfaces and registry
*/
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'

export type SttInput = {
  audioUrl?: string | null
  objectKey?: string | null
  languageHint?: string | null
}

export type SttResult = {
  provider: string
  text: string
  confidence?: number
  language?: string
}

export class ProviderNotConfiguredError extends Error {
  status = 501 as const
  constructor(message = 'STT provider not configured') {
    super(message)
    this.name = 'ProviderNotConfiguredError'
  }
}

export interface SttProvider {
  name: string
  transcribe(input: SttInput): Promise<SttResult>
}

// Mock provider
const mockStt: SttProvider = {
  name: 'mock',
  async transcribe(input: SttInput): Promise<SttResult> {
    const hint = input.audioUrl ?? input.objectKey ?? ''
    return {
      provider: 'mock',
      text: `mock transcript for: ${hint.slice(0, 64)}`,
      confidence: 0.92,
      language: input.languageHint ?? 'en',
    }
  },
}

// AWS Transcribe (Batch) — synchronous wrapper with short polling
const awsStt: SttProvider = {
  name: 'aws',
  async transcribe(input: SttInput): Promise<SttResult> {
    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || process.env.S3_REGION || 'us-east-1'
    const endpoint = process.env.AWS_ENDPOINT_URL // LocalStack compatibility (optional)
    const bucket = process.env.S3_BUCKET_AUDIO
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === '1'
    if (!bucket) throw new Error('S3_BUCKET_AUDIO is required for AWS STT')

    // Ensure media is in S3
    const s3 = new S3Client({ region, ...(endpoint ? { endpoint } : {}), forcePathStyle })
    let key = input.objectKey || null
    if (!key) {
      if (!input.audioUrl) throw new Error('audioUrl or objectKey is required for AWS STT')
      const res = await fetch(input.audioUrl)
      if (!res.ok) throw new Error(`Failed to fetch audioUrl: HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const ct = (res.headers.get('content-type') || 'audio/mpeg').toLowerCase()
      const ext = ct.includes('wav') ? 'wav' : ct.includes('webm') ? 'webm' : ct.includes('ogg') ? 'ogg' : ct.includes('mp3') || ct.includes('mpeg') ? 'mp3' : 'mp3'
      const day = new Date().toISOString().slice(0, 10)
      key = `audio/${day}/stt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buf, ContentType: ct }))
    }

    // Determine media format for Transcribe based on extension
    const ext = (key.split('.').pop() || '').toLowerCase()
    let mediaFormat: 'mp3' | 'mp4' | 'wav' | 'flac' | 'ogg' | 'amr' | 'webm' = 'mp3'
    if (ext === 'wav') mediaFormat = 'wav'
    else if (ext === 'mp3') mediaFormat = 'mp3'
    else if (ext === 'mp4' || ext === 'm4a') mediaFormat = 'mp4'
    else if (ext === 'flac') mediaFormat = 'flac'
    else if (ext === 'ogg') mediaFormat = 'ogg'
    else if (ext === 'amr') mediaFormat = 'amr'
    else if (ext === 'webm') mediaFormat = 'webm'

    const languageCode = input.languageHint || process.env.AWS_TRANSCRIBE_LANGUAGE || process.env.GOOGLE_SPEECH_LANGUAGE || 'en-US'

    // Lazy-load AWS Transcribe SDK
    const mod: any = await import('@aws-sdk/client-transcribe')
    const TranscribeClient = mod.TranscribeClient
    const StartTranscriptionJobCommand = mod.StartTranscriptionJobCommand
    const GetTranscriptionJobCommand = mod.GetTranscriptionJobCommand
    if (!TranscribeClient || !StartTranscriptionJobCommand || !GetTranscriptionJobCommand) {
      throw new Error('AWS Transcribe SDK not available')
    }

    const jobName = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const mediaUri = `s3://${bucket}/${key}`
    const transcribe = new TranscribeClient({ region, ...(endpoint ? { endpoint } : {}) })
    await transcribe.send(new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      LanguageCode: languageCode,
      MediaFormat: mediaFormat,
      Media: { MediaFileUri: mediaUri },
      OutputBucketName: bucket,
    }))

    // Poll for completion (up to ~60s)
    let lastStatus = 'IN_PROGRESS'
    for (let i = 0; i < 60; i++) {
      await sleep(1000)
      const out = await transcribe.send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }))
      const job = out.TranscriptionJob
      lastStatus = String(job?.TranscriptionJobStatus || '')
      if (lastStatus === 'COMPLETED') {
        const uri = job?.Transcript?.TranscriptFileUri as string | undefined
        // Attempt to fetch via HTTP; fallback to S3 access
        try {
          if (uri && uri.startsWith('http')) {
            const r = await fetch(uri)
            if (r.ok) {
              const j: any = await r.json()
              const text: string = j?.results?.transcripts?.[0]?.transcript || ''
              return { provider: 'aws', text, language: languageCode }
            }
          }
        } catch {}
        // Fallback: try to infer key when OutputBucketName is used
        const transcriptKey = `${jobName}.json`
        try {
          const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: transcriptKey }))
          const arr = await new Response(resp.Body as any).arrayBuffer()
          const j = JSON.parse(Buffer.from(arr).toString('utf-8'))
          const text: string = j?.results?.transcripts?.[0]?.transcript || ''
          return { provider: 'aws', text, language: languageCode }
        } catch (e) {
          throw new Error('AWS STT completed but transcript fetch failed')
        }
      }
      if (lastStatus === 'FAILED') {
        const reason = (out as any)?.TranscriptionJob?.FailureReason || 'Unknown reason'
        throw new Error(`AWS STT failed: ${reason}`)
      }
    }
    throw new Error(`AWS STT timed out waiting for job completion (last status=${lastStatus})`)
  },
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// Azure Cognitive Services Speech-to-Text integration (REST - short audio)
const azureStt: SttProvider = {
  name: 'azure',
  async transcribe(input: SttInput): Promise<SttResult> {
    const key = process.env.AZURE_SPEECH_KEY
    const region = process.env.AZURE_SPEECH_REGION
    if (!key || !region) {
      throw new ProviderNotConfiguredError('AZURE_SPEECH_KEY and AZURE_SPEECH_REGION are required')
    }

    const blob = await loadAudioBlob(input)
    const ctOrig = (blob.type || 'application/octet-stream').toLowerCase()

    // Determine acceptable content-type for Azure short-audio REST endpoint
    // Supported examples: audio/wav (PCM), audio/ogg; codecs=opus, audio/webm; codecs=opus
    let contentType = ctOrig
    if (ctOrig.includes('wav')) {
      contentType = 'audio/wav'
    } else if (ctOrig.includes('webm')) {
      contentType = 'audio/webm; codecs=opus'
    } else if (ctOrig.includes('ogg')) {
      contentType = 'audio/ogg; codecs=opus'
    } else if (ctOrig.includes('mpeg') || ctOrig.includes('mp3')) {
      // Azure may not always accept mp3 on REST; attempt and surface error if unsupported
      contentType = 'audio/mpeg'
    } else {
      throw new Error(`Unsupported content-type for Azure STT: ${ctOrig}`)
    }

    const ab = await blob.arrayBuffer()
    const languageCode = input.languageHint || process.env.AZURE_STT_LANGUAGE || process.env.GOOGLE_SPEECH_LANGUAGE || 'en-US'

    const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(
      languageCode,
    )}`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': contentType,
        'Accept': 'application/json',
      },
      body: ab,
    })
    if (!res.ok) {
      const t = await res.text()
      throw new Error(`Azure STT HTTP ${res.status}: ${t}`)
    }
    const data: any = await res.json()
    // Possible shapes:
    // { RecognitionStatus: 'Success', DisplayText: '...' }
    // or { NBest: [{ Display: '...', Lexical: '...' }, ...] }
    const text: string = data?.DisplayText || data?.NBest?.[0]?.Display || data?.NBest?.[0]?.Lexical || ''
    return { provider: 'azure', text, language: languageCode }
  },
}

// Google Cloud Speech-to-Text integration
const googleStt: SttProvider = {
  name: 'google',
  async transcribe(input: SttInput): Promise<SttResult> {
    // Require ADC to be configured (GOOGLE_APPLICATION_CREDENTIALS or equivalent)
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_CLOUD_PROJECT) {
      // Project env isn't strictly required but this gives a clearer config error in local dev
      throw new ProviderNotConfiguredError('Google Cloud ADC not configured (set GOOGLE_APPLICATION_CREDENTIALS)')
    }

    const blob = await loadAudioBlob(input)
    const ct = (blob.type || 'application/octet-stream').toLowerCase()
    // Map MIME to Google encoding
    type Encoding = 'WEBM_OPUS' | 'MP3' | 'LINEAR16'
    let encoding: Encoding | undefined
    if (ct.includes('webm')) encoding = 'WEBM_OPUS'
    else if (ct.includes('mpeg') || ct.includes('mp3')) encoding = 'MP3'
    else if (ct.includes('wav')) encoding = 'LINEAR16'
    else {
      throw new Error(`Unsupported content-type for Google STT: ${ct}`)
    }

    const ab = await blob.arrayBuffer()
    const content = Buffer.from(ab).toString('base64')
    const languageCode = input.languageHint || process.env.GOOGLE_SPEECH_LANGUAGE || 'en-US'

    // Lazy-load SDK to avoid bundling and type resolution when unused
    const loaded = (await import('@google-cloud/speech')) as unknown
    type RecognizeRequest = {
      audio: { content: string }
      config: {
        languageCode: string
        encoding?: Encoding
        enableAutomaticPunctuation?: boolean
        useEnhanced?: boolean
        sampleRateHertz?: number
        audioChannelCount?: number
      }
    }
    type RecognizeAlt = { transcript?: string }
    type RecognizeResult = { alternatives?: RecognizeAlt[] }
    type RecognizeResponse = { results?: RecognizeResult[] }
    type GoogleSpeechModule = {
      SpeechClient: new () => {
        recognize(req: RecognizeRequest): Promise<[RecognizeResponse]>
      }
    }
    const { SpeechClient } = loaded as GoogleSpeechModule
    if (!SpeechClient) throw new Error('Google Speech SDK not available')
    const client = new SpeechClient()
    // For WEBM_OPUS, explicitly set 48kHz and mono to avoid sample rate detection issues
    let sampleRateHertz: number | undefined
    let audioChannelCount: number | undefined
    if (encoding === 'WEBM_OPUS') {
      sampleRateHertz = 48000
      audioChannelCount = 1
    }

    const req: RecognizeRequest = {
      audio: { content },
      config: {
        languageCode,
        encoding,
        // Enable automatic punctuation for readability
        enableAutomaticPunctuation: true,
        // Use enhanced model when available
        useEnhanced: true,
        sampleRateHertz,
        audioChannelCount,
      },
    }
    const [resp] = await client.recognize(req)

    const results = (resp.results ?? []) as RecognizeResult[]
    const text = results
      .map((r) => (r.alternatives?.[0]?.transcript ?? ''))
      .filter(Boolean)
      .join(' ')
      .trim()

    return { provider: 'google', text, language: languageCode }
  },
}

// Deepgram STT (REST - short audio)
const deepgramStt: SttProvider = {
  name: 'deepgram',
  async transcribe(input: SttInput): Promise<SttResult> {
    const key = process.env.DEEPGRAM_API_KEY
    if (!key) throw new ProviderNotConfiguredError('DEEPGRAM_API_KEY is missing')

    const blob = await loadAudioBlob(input)
    const ctOrig = (blob.type || 'application/octet-stream').toLowerCase()
    // Allow common types Deepgram accepts
    let contentType = ctOrig
    if (ctOrig.includes('webm')) contentType = 'audio/webm; codecs=opus'
    else if (ctOrig.includes('ogg')) contentType = 'audio/ogg; codecs=opus'
    else if (ctOrig.includes('wav')) contentType = 'audio/wav'
    else if (ctOrig.includes('mpeg') || ctOrig.includes('mp3')) contentType = 'audio/mpeg'

    const ab = await blob.arrayBuffer()
    const language = input.languageHint || process.env.DEEPGRAM_LANGUAGE || process.env.GOOGLE_SPEECH_LANGUAGE || 'en-US'
    const model = process.env.DEEPGRAM_MODEL || 'nova-2'
    const punctuate = 'true'
    const url = `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(model)}&language=${encodeURIComponent(
      language,
    )}&punctuate=${punctuate}`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${key}`,
        'Content-Type': contentType,
        Accept: 'application/json',
      },
      body: ab,
    })
    if (!res.ok) {
      const t = await res.text()
      throw new Error(`Deepgram STT HTTP ${res.status}: ${t}`)
    }
    const data: any = await res.json()
    // Expected shape: { results: { channels: [ { alternatives: [ { transcript: string } ] } ] } }
    const text: string =
      data?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.toString?.() || ''
    return { provider: 'deepgram', text, language }
  },
}

// Helpers for fetching audio
async function loadAudioBlob(input: SttInput): Promise<Blob> {
  if (input.audioUrl) {
    const res = await fetch(input.audioUrl)
    if (!res.ok) throw new Error(`Failed to fetch audioUrl: HTTP ${res.status}`)
    const buf = await res.arrayBuffer()
    const ct = res.headers.get('content-type') || 'application/octet-stream'
    return new Blob([buf], { type: ct })
  }
  if (input.objectKey) {
    const region = process.env.S3_REGION || 'us-east-1'
    const endpoint = process.env.S3_ENDPOINT_URL
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === '1'
    const bucket = process.env.S3_BUCKET_AUDIO
    if (!bucket) throw new Error('S3_BUCKET_AUDIO is required for objectKey STT')
    const s3 = new S3Client({ region, ...(endpoint ? { endpoint } : {}), forcePathStyle })
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: input.objectKey }))
    const body = out.Body as unknown as ReadableStream
    const arr = await new Response(body).arrayBuffer()
    const ct = (out.ContentType as string) || 'application/octet-stream'
    return new Blob([arr], { type: ct })
  }
  throw new Error('audioUrl or objectKey is required')
}

// OpenAI Whisper integration
const openaiStt: SttProvider = {
  name: 'openai',
  async transcribe(input: SttInput): Promise<SttResult> {
    const key = process.env.OPENAI_API_KEY
    if (!key) throw new ProviderNotConfiguredError('OPENAI_API_KEY is missing')

    const blob = await loadAudioBlob(input)
    const fd = new FormData()
    const filename = 'audio'
    fd.append('file', blob, filename)
    fd.append('model', process.env.OPENAI_STT_MODEL || 'whisper-1')
    if (input.languageHint) fd.append('language', input.languageHint)

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: fd,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`OpenAI STT HTTP ${res.status}: ${text}`)
    }
    const data = await res.json()
    // Expect shape: { text: string }
    const text: string = data.text || ''
    return { provider: 'openai', text, language: input.languageHint || undefined }
  },
}

export function getSttProvider(name?: string): SttProvider {
  const id = (name || process.env.STT_PROVIDER || 'mock').toLowerCase()
  switch (id) {
    case 'aws':
    case 'transcribe':
      return awsStt
    case 'azure':
      return azureStt
    case 'google':
      return googleStt
    case 'deepgram':
      return deepgramStt
    case 'openai':
      return openaiStt
    case 'mock':
    default:
      return mockStt
  }
}
