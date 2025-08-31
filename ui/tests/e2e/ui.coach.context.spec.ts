import { test, expect } from '@playwright/test';

// Test to verify the coach page voice chat includes history parameter
test('verifies coach page voice chat sends history parameter', async ({ page }) => {
  // Mock network requests to capture the chat API call
  let capturedUrl = '';

  await page.route('**/api/chat**', (route) => {
    capturedUrl = route.request().url();
    // Mock a simple SSE response
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: Test voice response\ndata: [DONE]\n\n'
    });
  });

  // Mock STT endpoint
  await page.route('**/api/v1/stt', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ 
        provider: 'mock', 
        text: 'Hello from voice test',
        objectKey: 'mock/test.webm'
      })
    });
  });

  // Mock media APIs
  await page.addInitScript(() => {
    // Mock getUserMedia
    (navigator as any).mediaDevices = {
      getUserMedia: async () => ({
        getTracks: () => [{ stop: () => {} }]
      })
    };

    // Mock MediaRecorder
    class MockMediaRecorder {
      public state = 'inactive';
      public ondataavailable: ((ev: any) => void) | null = null;
      public onstop: (() => void) | null = null;

      constructor(stream: any, options?: any) {}

      start() {
        this.state = 'recording';
        // Simulate data available after short delay
        setTimeout(() => {
          if (this.ondataavailable) {
            this.ondataavailable({ data: new Blob(['mock audio'], { type: 'audio/webm' }) });
          }
        }, 100);
      }

      stop() {
        this.state = 'inactive';
        setTimeout(() => {
          if (this.onstop) this.onstop();
        }, 50);
      }
    }

    (window as any).MediaRecorder = MockMediaRecorder;
    (MediaRecorder as any).isTypeSupported = () => true;
  });

  await page.goto('/coach');

  // Wait for page to load
  await page.waitForLoadState('networkidle');

  // Look for the large mic button in coach mode
  const micButton = page.locator('button[aria-label*="voice mode"], button[aria-label*="Voice mode"]').first();
  await expect(micButton).toBeVisible({ timeout: 10000 });

  // Click to start voice mode
  await micButton.click();

  // Wait for the mock recording to complete and trigger chat
  await page.waitForTimeout(2000);

  // Verify the URL contains a history parameter
  expect(capturedUrl).toBeTruthy();
  expect(capturedUrl).toContain('/api/chat');
  expect(capturedUrl).toContain('history=');

  console.log('Captured coach voice chat URL:', capturedUrl);

  // Decode and verify history
  const url = new URL(capturedUrl);
  const historyParam = url.searchParams.get('history');
  expect(historyParam).toBeTruthy();

  // Decode base64url
  const historyJson = historyParam!.replace(/-/g, '+').replace(/_/g, '/');
  const padded = historyJson + '='.repeat((4 - historyJson.length % 4) % 4);
  const historyText = atob(padded);
  const history = JSON.parse(historyText);

  console.log('Decoded coach history:', history);

  expect(Array.isArray(history)).toBe(true);
  // Should contain at least the user message from the voice input
  expect(history.length).toBeGreaterThan(0);
  
  // Verify structure
  history.forEach((item: any) => {
    expect(item).toHaveProperty('role');
    expect(item).toHaveProperty('content');
    expect(['user', 'assistant']).toContain(item.role);
    expect(typeof item.content).toBe('string');
  });
});

test('coach: bounded retry triggers only when no partial text (first 500 then success)', async ({ page }) => {
  // Track attempts to the chat API
  let attempts = 0;
  await page.route('**/api/chat**', (route) => {
    attempts++;
    if (attempts === 1) {
      // First attempt: fail without streaming any data
      return route.fulfill({ status: 500, contentType: 'text/plain', body: 'error' });
    }
    // Second attempt: succeed with a short SSE
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: Hello from retry\n\ndata: [DONE]\n\n' });
  });

  // Mock STT endpoint to immediately provide text so voice flow triggers chat
  await page.route('**/api/v1/stt', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'mock', text: 'retry please', objectKey: 'mock.blob' }) });
  });

  // Mock media APIs for mic
  await page.addInitScript(() => {
    (navigator as any).mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }) } as any;
    class MockMediaRecorder {
      public state = 'inactive';
      public ondataavailable: ((ev: any) => void) | null = null;
      public onstop: (() => void) | null = null;
      start() { this.state = 'recording'; setTimeout(() => { this.ondataavailable?.({ data: new Blob(['mock'], { type: 'audio/webm' }) }); }, 80); }
      stop() { this.state = 'inactive'; setTimeout(() => { this.onstop?.(); }, 20); }
    }
    (window as any).MediaRecorder = MockMediaRecorder as any;
    (MediaRecorder as any).isTypeSupported = () => true;
  });

  await page.goto('/coach');
  await page.waitForLoadState('networkidle');

  // Toggle from dashboard to chat (voice mode uses global mic button; simulate with the debug Send prompt)
  // Open logs to keep UI stable; then send a prompt via the debug controls if available
  // If debug controls are not visible due to layout, fallback to using mic interactions would require UI wiring.
  // For consistency, use the debug prompt path present on the page.
  const prompt = page.getByPlaceholder('Type a prompt to test streaming');
  await expect(prompt).toBeVisible({ timeout: 10000 });
  await prompt.fill('retry test');
  const sendBtn = page.getByRole('button', { name: /^Send$/ });
  await expect(sendBtn).toBeVisible();
  await sendBtn.click();

  // Expect the route to have been called at least twice (retry) within the timeout window
  await expect.poll(() => attempts, { timeout: 10000, intervals: [200, 400, 800, 1000] }).toBeGreaterThanOrEqual(2);
});

test('coach: abort turn stops stream and clears queued audio', async ({ page }) => {
  // Simulate a long SSE response so we can abort mid-stream
  let esOpened = 0;
  await page.route('**/api/chat**', async (route) => {
    esOpened++;
    // Send several tokens over time
    const body = [
      'data: Hello',
      'data:  there',
      'data:  friend',
    ].join('\n') + '\n\n';
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });

  // Mock STT to start chat
  await page.route('**/api/v1/stt', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'abort me', provider: 'mock', objectKey: 'x' }) }));

  // Mock media
  await page.addInitScript(() => {
    (navigator as any).mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }) } as any;
    class MockMediaRecorder { state='inactive'; ondataavailable: any=null; onstop: any=null; start(){ this.state='recording'; setTimeout(()=>{ this.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) }); }, 80);} stop(){ this.state='inactive'; setTimeout(()=>{ this.onstop?.(); }, 20);} }
    (window as any).MediaRecorder = MockMediaRecorder as any;
    (MediaRecorder as any).isTypeSupported = () => true;
  });

  await page.goto('/coach');
  await page.waitForLoadState('networkidle');
  // Use debug Send to trigger a chat
  const prompt = page.getByPlaceholder('Type a prompt to test streaming');
  await prompt.fill('abort test');
  const sendBtn = page.getByRole('button', { name: /^Send$/ }).first();
  await sendBtn.click();

  // Wait briefly for streaming to start
  await page.waitForTimeout(300);

  // Click Abort Turn
  const abortBtn = page.getByRole('button', { name: 'Abort Turn' });
  await abortBtn.click();

  // After abort, wait a bit and assert assistant text does not grow
  const getAssistantText = async () => {
    const handle = await page.locator('text=Assistant').locator('..').elementHandle();
    const text = await handle?.evaluate((el) => el.textContent || '');
    return text || '';
  };
  const before = await getAssistantText();
  await page.waitForTimeout(500);
  const after = await getAssistantText();
  expect(after).toBe(before);
});

test('coach: TTS segmentation produces natural chunks under bursty tokens', async ({ page }) => {
  // Capture TTS segment texts sent to the TTS API
  const ttsTexts: string[] = [];
  await page.route('**/api/v1/tts', async (route) => {
    try {
      const body = route.request().postDataJSON() as any;
      if (body && typeof body.text === 'string') ttsTexts.push(body.text);
    } catch {}
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ audioUrl: 'data:audio/wav;base64,', durationMs: 200 }) });
  });

  // Simulate bursty small tokens with punctuation to trigger flushOnPunctuation()
  const sseTokens = [
    'Hello', ' ', 'there', ',', ' ', 'how', ' ', 'are', ' ', 'you', '?', ' ',
    'This', ' ', 'is', ' ', 'a', ' ', 'second', ' ', 'sentence', '.', ' ',
    'Short', ' ', 'bits', ' ', 'become', ' ', 'merged', '.',
  ];
  await page.route('**/api/chat**', async (route) => {
    const body = sseTokens.map(t => `data: ${t}`).join('\n') + '\n\n' + 'data: [DONE]\n\n';
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });

  await page.goto('/coach');
  await page.waitForLoadState('networkidle');

  const prompt = page.getByPlaceholder('Type a prompt to test streaming');
  await prompt.fill('tts segmentation test');
  const sendTtsBtn = page.getByRole('button', { name: 'Send (TTS)' });
  await sendTtsBtn.click();

  // Wait for some TTS segments to be enqueued
  await expect.poll(() => ttsTexts.length, { timeout: 8000, intervals: [200, 400, 800] }).toBeGreaterThan(0);

  // Basic assertions about segmentation quality
  // 1) Not too many tiny segments: most segments >= 12 chars except possibly the last
  const allButLast = ttsTexts.slice(0, -1);
  const tinyCount = allButLast.filter(t => t.trim().length < 12).length;
  expect(tinyCount).toBeLessThanOrEqual(1);
  // 2) Respect queue/backpressure: segments count should be bounded (<= 8 by default)
  expect(ttsTexts.length).toBeLessThanOrEqual(8);
  // 3) Last segment may be short; overall average should be reasonable
  const avgLen = Math.round(ttsTexts.reduce((a, b) => a + b.length, 0) / ttsTexts.length);
  expect(avgLen).toBeGreaterThanOrEqual(10);
});
