import { test, expect } from '@playwright/test';

// Mock EventSource to control SSE responses and inspect requests
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
        // Store the URL for inspection
        (window as any).lastChatUrl = url;
        // Simulate open
        setTimeout(() => {
          this.readyState = 1; // OPEN
          try { this.onopen?.(new Event('open') as any); } catch {}
          // Stream some response then done
          try { this.onmessage?.(new MessageEvent('message', { data: 'Test response ' }) as any); } catch {}
          setTimeout(() => {
            try { this.onmessage?.(new MessageEvent('message', { data: 'from mock.' }) as any); } catch {}
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

// Helper to decode base64url
function base64UrlDecode(str: string): string {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
}

test.describe('Chat Context Persistence', () => {
  test('passes last 10 messages as history parameter to backend', async ({ page }) => {
    await installEventSourceMock(page);
    await page.goto('/chat');
    
    // Wait for page to be fully loaded
    await page.waitForLoadState('networkidle');
    
    // Wait for the input field to be visible
    const promptInput = page.getByPlaceholder('Type a prompt…');
    await expect(promptInput).toBeVisible({ timeout: 10000 });
    
    // First interaction
    await promptInput.fill('First message');
    const sendButton = page.getByRole('button', { name: 'Send' });
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    // Wait for first response to complete
    await expect(page.getByText('[DONE]')).toBeVisible({ timeout: 10000 });

    // Second interaction
    await promptInput.fill('Second message');
    await sendButton.click();

    // Wait for second response to complete
    await expect(page.getByText('[DONE]')).toBeVisible({ timeout: 10000 });

    // Third interaction - this should include history from first two exchanges
    await promptInput.fill('Third message');
    await sendButton.click();

    // Wait for third response to complete
    await expect(page.getByText('[DONE]')).toBeVisible({ timeout: 10000 });

    // Get the last chat URL from the mock
    const lastChatUrl = await page.evaluate(() => (window as any).lastChatUrl as string);
    expect(lastChatUrl).toBeTruthy();

    // Parse the URL and check for history parameter
    const url = new URL(lastChatUrl);
    const historyParam = url.searchParams.get('history');
    expect(historyParam, 'History parameter should be present in chat URL').toBeTruthy();

    // Decode and verify history contents
    const historyJson = base64UrlDecode(historyParam!);
    const history = JSON.parse(historyJson);

    // Should contain messages from the last interactions (up to 10, but we expect 4 here)
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThan(0);

    // Verify structure of history items
    history.forEach((item: any) => {
      expect(item).toHaveProperty('role');
      expect(item).toHaveProperty('content');
      expect(['user', 'assistant']).toContain(item.role);
      expect(typeof item.content).toBe('string');
      expect(item.content.length).toBeGreaterThan(0);
    });

    // Should include our recent messages
    const userMessages = history.filter((item: any) => item.role === 'user');
    const assistantMessages = history.filter((item: any) => item.role === 'assistant');

    expect(userMessages.length).toBeGreaterThanOrEqual(2); // At least from second and third interactions
    expect(assistantMessages.length).toBeGreaterThanOrEqual(2); // At least from second and third interactions

    // Check that recent messages are present (trimmed to ~240 chars)
    const userContents = userMessages.map((item: any) => item.content);
    expect(userContents.some((content: string) => content.includes('Second message'))).toBe(true);
    expect(userContents.some((content: string) => content.includes('Third message'))).toBe(true);

    const assistantContents = assistantMessages.map((item: any) => item.content);
    expect(assistantContents.some((content: string) => content.includes('Test response'))).toBe(true);
  });

  test('persists context across page refresh', async ({ page }) => {
    await installEventSourceMock(page);
    await page.goto('/chat');
    
    // Wait for page to be fully loaded
    await page.waitForLoadState('networkidle');
    
    // Wait for the input field to be visible
    const promptInput = page.getByPlaceholder('Type a prompt…');
    await expect(promptInput).toBeVisible({ timeout: 10000 });
    
    // First interaction
    await promptInput.fill('Persistent message');
    const sendButton = page.getByRole('button', { name: 'Send' });
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    // Wait for response
    await expect(page.getByText('[DONE]')).toBeVisible({ timeout: 10000 });

    // Refresh the page (this should preserve the sessionId and history)
    await page.reload();
    
    // Wait for page to reload and be ready
    await page.waitForLoadState('networkidle');
    await expect(promptInput).toBeVisible({ timeout: 10000 });
    
    // Second interaction after refresh
    await promptInput.fill('After refresh message');
    await sendButton.click();

    // Wait for response
    await expect(page.getByText('[DONE]')).toBeVisible({ timeout: 10000 });

    // Verify history includes messages from before refresh
    const lastChatUrl = await page.evaluate(() => (window as any).lastChatUrl as string);
    const url = new URL(lastChatUrl);
    const historyParam = url.searchParams.get('history');
    expect(historyParam).toBeTruthy();

    const historyJson = base64UrlDecode(historyParam!);
    const history = JSON.parse(historyJson);

    // Should include both the persistent message and the new one
    const userMessages = history.filter((item: any) => item.role === 'user');
    const assistantMessages = history.filter((item: any) => item.role === 'assistant');

    expect(userMessages.length).toBeGreaterThanOrEqual(2);
    expect(assistantMessages.length).toBeGreaterThanOrEqual(2);

    // Verify the persistent message is there
    const userContents = userMessages.map((item: any) => item.content);
    expect(userContents.some((content: string) => content.includes('Persistent message'))).toBe(true);
    expect(userContents.some((content: string) => content.includes('After refresh message'))).toBe(true);
  });
});
