import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { getTtsProvider, ProviderNotConfiguredError } from './tts'
import { devLog } from '../observability'

describe('TTS provider adapters', () => {
  beforeAll(() => {
    devLog("info", "test:tts: Test suite started", {
      timestamp: new Date().toISOString(),
      testCount: 2
    });
  });

  afterAll(() => {
    devLog("info", "test:tts: Test suite completed", {
      timestamp: new Date().toISOString()
    });
  });

  beforeEach(() => {
    devLog("debug", "test:tts: Test setup", {
      testName: expect.getState().currentTestName
    });
  });

  afterEach(() => {
    devLog("debug", "test:tts: Test teardown", {
      testName: expect.getState().currentTestName,
      passed: expect.getState().currentTestResult?.passed ?? false
    });
  });

  it('mock provider returns audioUrl', async () => {
    devLog("info", "test:tts: Mock provider test started", {
      testName: 'mock provider returns audioUrl'
    });

    const p = getTtsProvider('mock')
    const res = await p.synthesize({ text: 'hello world', format: 'audio/mpeg' })

    devLog("debug", "test:tts: Mock provider assertion", {
      expectedProvider: 'mock',
      actualProvider: res.provider,
      expectedAudioUrlContains: 'http',
      actualAudioUrl: res.audioUrl
    });

    expect(res.provider).toBe('mock')
    expect(res.audioUrl).toContain('http')

    devLog("info", "test:tts: Mock provider test passed", {
      provider: res.provider,
      audioUrl: res.audioUrl,
      textLength: 'hello world'.length
    });
  })

  it('openai provider throws when OPENAI_API_KEY missing', async () => {
    devLog("info", "test:tts: OpenAI provider test started", {
      testName: 'openai provider throws when OPENAI_API_KEY missing'
    });

    const prev = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    const p = getTtsProvider('openai')

    devLog("debug", "test:tts: OpenAI provider setup", {
      hasApiKeyBefore: !!prev,
      hasApiKeyAfter: !!process.env.OPENAI_API_KEY
    });

    await expect(p.synthesize({ text: 'x' })).rejects.toBeInstanceOf(ProviderNotConfiguredError)

    devLog("debug", "test:tts: OpenAI provider assertion passed", {
      expectedError: 'ProviderNotConfiguredError',
      providerName: 'openai'
    });

    if (prev) process.env.OPENAI_API_KEY = prev

    devLog("debug", "test:tts: OpenAI provider cleanup", {
      hasApiKeyRestored: !!process.env.OPENAI_API_KEY
    });

    devLog("info", "test:tts: OpenAI provider test passed", {
      testName: 'openai provider throws when OPENAI_API_KEY missing'
    });
  })
})
