import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveProvider } from '../../src/app/api/lib/speech/registry'

const OLD_ENV = { ...process.env }

describe('speech provider resolver', () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV }
    delete process.env.STT_PROVIDER
    delete process.env.TTS_PROVIDER
    delete process.env.SPEECH_PROFILE
  })
  afterEach(() => {
    process.env = { ...OLD_ENV }
  })

  it('defaults to mock when nothing set', () => {
    const stt = resolveProvider('stt', { envName: process.env.STT_PROVIDER, allowOverride: false })
    const tts = resolveProvider('tts', { envName: process.env.TTS_PROVIDER, allowOverride: false })
    expect(stt.name).toBe('mock')
    expect(tts.name).toBe('mock')
  })

  it('uses SPEECH_PROFILE when specific envs are unset', () => {
    process.env.SPEECH_PROFILE = 'openai'
    const stt = resolveProvider('stt', { envName: process.env.STT_PROVIDER, allowOverride: false })
    const tts = resolveProvider('tts', { envName: process.env.TTS_PROVIDER, allowOverride: false })
    expect(stt.name).toBe('openai')
    expect(tts.name).toBe('openai')
  })

  it('specific env overrides SPEECH_PROFILE', () => {
    process.env.SPEECH_PROFILE = 'openai'
    const stt = resolveProvider('stt', { envName: 'mock', allowOverride: false })
    expect(stt.name).toBe('mock')
  })

  it('request override beats envs when allowed', () => {
    process.env.STT_PROVIDER = 'mock'
    const stt = resolveProvider('stt', { envName: process.env.STT_PROVIDER, requestedName: 'openai', allowOverride: true })
    expect(stt.name).toBe('openai')
  })
})
