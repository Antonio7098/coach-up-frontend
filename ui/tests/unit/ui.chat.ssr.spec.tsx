import React from 'react';
import { renderToString } from 'react-dom/server';
import ChatPage from '../../src/app/chat/page';

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
