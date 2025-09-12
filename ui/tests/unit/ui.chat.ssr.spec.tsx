import React from 'react';
import { renderToString } from 'react-dom/server';
import { vi } from 'vitest';
import ChatPage from '../../src/app/chat/page';

// Mock Clerk hooks for SSR test
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({
    getToken: vi.fn().mockResolvedValue(null),
  }),
}));

// Mock localStorage for SSR
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
global.localStorage = localStorageMock as any;

describe('ChatPage SSR', () => {
  it('renders without a concrete sessionId on server (no randomness)', () => {
    const html = renderToString(React.createElement(ChatPage));
    // Should show placeholder since useEffect does not run on server
    expect(html).toContain('(initializing…)');
    // Should NOT contain a UUID-looking string (regression guard against module-scope randomness)
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    expect(uuidRe.test(html)).toBe(false);
  });
});
