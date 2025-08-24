import { describe, it, expect } from 'vitest'
import { getSttProvider, ProviderNotConfiguredError } from './stt'

describe('STT provider adapters', () => {
  it('mock provider returns deterministic transcript', async () => {
    const p = getSttProvider('mock')
    const res = await p.transcribe({ audioUrl: 'https://example.com/a.wav' })
    expect(res.provider).toBe('mock')
    expect(res.text).toContain('mock transcript')
  })

  it('openai provider throws when OPENAI_API_KEY missing', async () => {
    const prev = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    const p = getSttProvider('openai')
    await expect(p.transcribe({ audioUrl: 'x' })).rejects.toBeInstanceOf(ProviderNotConfiguredError)
    if (prev) process.env.OPENAI_API_KEY = prev
  })
})
