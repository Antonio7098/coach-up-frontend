import { test, expect } from '@playwright/test';

// Install browser-side mocks for Media APIs before the page loads
async function installMediaMocks(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    // Mock navigator.mediaDevices.getUserMedia
    // and a simple MediaRecorder that buffers a few chunks then stops
    const g: any = globalThis as any;
    if (!g.navigator) (g as any).navigator = {};
    if (!g.navigator.mediaDevices) g.navigator.mediaDevices = {} as any;

    g.navigator.mediaDevices.getUserMedia = async () => {
      return {
        getTracks() { return [{ stop() {} }]; }
      } as any;
    };

    class MockMediaRecorder {
      public stream: MediaStream;
      public mimeType: string;
      public state: 'inactive' | 'recording' | 'paused' = 'inactive';
      public ondataavailable: ((ev: BlobEvent) => void) | null = null;
      public onstop: (() => void) | null = null;
      private _timer: any = null;
      private _emitted: boolean = false;

      constructor(stream: MediaStream, opts?: { mimeType?: string }) {
        this.stream = stream;
        this.mimeType = opts?.mimeType || 'audio/webm;codecs=opus';
      }

      start(timeslice?: number) {
        this.state = 'recording';
        // Emit a couple of small chunks and then stop automatically
        const makeChunk = () => new Blob([new Uint8Array([1,2,3,4,5])], { type: 'audio/webm' });
        let emitted = 0;
        this._timer = setInterval(() => {
          emitted += 1;
          try {
            // Avoid BlobEvent constructor dependency; pass a simple object
            const evt: any = { data: makeChunk() };
            this.ondataavailable?.(evt);
            this._emitted = true;
          } catch {}
          if (emitted >= 3) {
            clearInterval(this._timer);
            this._timer = null;
            this.stop();
          }
        }, Math.max(50, timeslice || 50));
      }

      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        try {
          if (!this._emitted) {
            const evt: any = { data: new Blob([new Uint8Array([9,9,9])], { type: 'audio/webm' }) };
            this.ondataavailable?.(evt);
            this._emitted = true;
          }
        } catch {}
        try { this.onstop?.(); } catch {}
      }
    }

    (g as any).MediaRecorder = MockMediaRecorder;
    (g as any).MediaRecorder.isTypeSupported = (mt: string) => typeof mt === 'string' && mt.startsWith('audio/webm');
  });
}

// Mock EventSource to avoid flakiness with SSE routing
async function installEventSourceMock(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    class MockEventSource {
      url: string;
      withCredentials: boolean;
      onopen: ((ev: any) => any) | null = null;
      onmessage: ((ev: any) => any) | null = null;
      onerror: ((ev: any) => any) | null = null;
      readyState: number = 0; // CONNECTING
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      constructor(url: string, opts?: { withCredentials?: boolean }) {
        this.url = url;
        this.withCredentials = !!opts?.withCredentials;
        // Simulate open
        setTimeout(() => {
          this.readyState = 1; // OPEN
          try { this.onopen?.(new Event('open') as any); } catch {}
          // Stream two chunks then done
          try { this.onmessage?.(new MessageEvent('message', { data: 'This is ' }) as any); } catch {}
          setTimeout(() => {
            try { this.onmessage?.(new MessageEvent('message', { data: 'a test reply.' }) as any); } catch {}
            setTimeout(() => {
              try { this.onmessage?.(new MessageEvent('message', { data: '[DONE]' }) as any); } catch {}
            }, 50);
          }, 50);
        }, 10);
      }
      close() { this.readyState = 2; /* CLOSED */ }
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() { return true; }
    }
    (window as any).EventSource = MockEventSource as any;
  });
}

// Network mocks for storage, STT, chat SSE, and TTS
async function installNetworkMocks(page: import('@playwright/test').Page) {
  const flags: any = { presign: 0, put: 0, stt: 0, chat: 0, tts: 0 };
  (page as any).__voiceFlags = flags;
  // Presign
  await page.route('**/api/v1/storage/audio/presign', async (route) => {
    console.log('[mock] presign called');
    flags.presign += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        objectKey: 'mock/object-1.webm',
        url: 'http://localhost:4555/mock-put-url',
        headers: { 'x-amz-meta-test': '1' },
      }),
    });
  });

  // S3 PUT (presigned)
  await page.route('http://localhost:4555/**', async (route) => {
    console.log('[mock] s3 put called');
    flags.put += 1;
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 200, body: '' });
    } else {
      await route.continue();
    }
  });

  // STT
  await page.route('**/api/v1/stt', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    console.log('[mock] stt called');
    flags.stt += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'mock', text: 'hello world', objectKey: 'mock/object-1.webm' }),
    });
  });

  // Chat SSE is mocked at EventSource level, so no network route needed

  // TTS
  await page.route('**/api/v1/tts', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    console.log('[mock] tts called');
    flags.tts += 1;
    const dataUrl = 'data:audio/mpeg;base64,/+MyFAKEBASE64MP3==';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'mock', audioUrl: dataUrl }),
    });
  });
}

const voiceUrl = '/chat/voice';

test.describe('Chat Voice Mode', () => {
  test('record -> upload+transcribe -> chat+tts', async ({ page }) => {
    // Debug: surface browser console and page errors in test logs
    page.on('console', (msg) => console.log(`[browser:${msg.type()}]`, msg.text()));
    page.on('pageerror', (err) => console.error('[pageerror]', err));

    await installMediaMocks(page);
    await installEventSourceMock(page);
    await installNetworkMocks(page);
    await page.goto(voiceUrl);

    await expect(page.getByRole('heading', { name: 'Chat Voice Mode' })).toBeVisible();

    // Start and stop recording (mock emits and auto-stops after ~150ms)
    const startBtn = page.getByRole('button', { name: 'Start Recording' });
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    // Explicitly stop to avoid races
    const stopBtn = page.getByRole('button', { name: 'Stop' });
    await expect(stopBtn).toBeEnabled();
    await stopBtn.click();

    // Wait for blob summary to appear
    await expect(page.getByText(/Recorded: .* KB, type:/)).toBeVisible();

    // Upload + Transcribe
    const transcribeBtn = page.getByRole('button', { name: /Upload \+ Transcribe/ });
    await transcribeBtn.click();

    await expect(page.getByText('Transcript')).toBeVisible();
    await expect(page.getByText('hello world')).toBeVisible();
    await expect(page.getByText(/objectKey:/)).toBeVisible();

    // Chat + TTS
    const ttsBtn = page.getByRole('button', { name: /Chat \+ TTS/ });
    await ttsBtn.click();

    await expect(page.getByText('Assistant')).toBeVisible();
    await expect(page.getByText('This is a test reply.')).toBeVisible();

    // Ensure TTS is invoked
    // Retry clicking if needed (guard against accidental early disable state)
    await page.waitForFunction(() => (window as any).location.pathname.includes('/chat/voice'));
    await page.waitForFunction(() => {
      const f = (window as any).playwright?
        (window as any).playwright : undefined;
      return true;
    });
    const ttsInvoked = async () => (page as any).__voiceFlags?.tts > 0;
    // Quick retry loop for click if tts not yet called
    for (let i = 0; i < 2; i++) {
      if (await ttsInvoked()) break;
      await ttsBtn.click();
      await page.waitForTimeout(200);
    }

    // Wait for Playback section or audio element to appear
    const audio = page.locator('audio[src^="data:"]');
    await Promise.race([
      page.getByText('Playback').waitFor({ state: 'visible', timeout: 20000 }),
      audio.waitFor({ state: 'visible', timeout: 20000 }),
    ]);
    await expect(audio).toBeVisible({ timeout: 20000 });
  });
});
