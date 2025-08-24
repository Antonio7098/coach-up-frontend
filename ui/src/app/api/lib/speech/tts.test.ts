import { describe, it, expect } from 'vitest'
import { getTtsProvider, ProviderNotConfiguredError } from './tts'

describe('TTS provider adapters', () => {
  it('mock provider returns audioUrl', async () => {
    const p = getTtsProvider('mock')
    const res = await p.synthesize({ text: 'hello world', format: 'audio/mpeg' })
    expect(res.provider).toBe('mock')
    expect(res.audioUrl).toContain('http')
  })

  it('openai provider throws when OPENAI_API_KEY missing', async () => {
    const prev = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    const p = getTtsProvider('openai')
    await expect(p.synthesize({ text: 'x' })).rejects.toBeInstanceOf(ProviderNotConfiguredError)
    if (prev) process.env.OPENAI_API_KEY = prev
  })
})
