import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { getSttProvider, ProviderNotConfiguredError } from './stt'
import { devLog } from '../observability'

describe('STT provider adapters', () => {
  beforeAll(() => {
    devLog("info", "test:stt: Test suite started", {
      timestamp: new Date().toISOString(),
      testCount: 2
    });
  });

  afterAll(() => {
    devLog("info", "test:stt: Test suite completed", {
      timestamp: new Date().toISOString()
    });
  });

  beforeEach(() => {
    devLog("debug", "test:stt: Test setup", {
      testName: expect.getState().currentTestName
    });
  });

  afterEach(() => {
    devLog("debug", "test:stt: Test teardown", {
      testName: expect.getState().currentTestName,
      passed: expect.getState().currentTestResult?.passed ?? false
    });
  });

  it('mock provider returns deterministic transcript', async () => {
    devLog("info", "test:stt: Mock provider test started", {
      testName: 'mock provider returns deterministic transcript'
    });

    const p = getSttProvider('mock')
    const res = await p.transcribe({ audioUrl: 'https://example.com/a.wav' })

    devLog("debug", "test:stt: Mock provider assertion", {
      expectedProvider: 'mock',
      actualProvider: res.provider,
      expectedTextContains: 'mock transcript',
      actualText: res.text
    });

    expect(res.provider).toBe('mock')
    expect(res.text).toContain('mock transcript')

    devLog("info", "test:stt: Mock provider test passed", {
      provider: res.provider,
      textLength: res.text.length
    });
  })

  it('openai provider throws when OPENAI_API_KEY missing', async () => {
    devLog("info", "test:stt: OpenAI provider test started", {
      testName: 'openai provider throws when OPENAI_API_KEY missing'
    });

    const prev = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    const p = getSttProvider('openai')

    devLog("debug", "test:stt: OpenAI provider setup", {
      hasApiKeyBefore: !!prev,
      hasApiKeyAfter: !!process.env.OPENAI_API_KEY
    });

    await expect(p.transcribe({ audioUrl: 'x' })).rejects.toBeInstanceOf(ProviderNotConfiguredError)

    devLog("debug", "test:stt: OpenAI provider assertion passed", {
      expectedError: 'ProviderNotConfiguredError',
      providerName: 'openai'
    });

    if (prev) process.env.OPENAI_API_KEY = prev

    devLog("debug", "test:stt: OpenAI provider cleanup", {
      hasApiKeyRestored: !!process.env.OPENAI_API_KEY
    });

    devLog("info", "test:stt: OpenAI provider test passed", {
      testName: 'openai provider throws when OPENAI_API_KEY missing'
    });
  })
})
