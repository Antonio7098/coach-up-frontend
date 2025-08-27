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
