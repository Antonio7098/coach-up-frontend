import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST as sessionSummaryPOST } from '../../src/app/api/v1/session-summary/route';

// Mock dependencies
vi.mock('../../src/app/api/lib/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../../src/app/api/lib/convex', () => ({
  makeConvex: vi.fn(),
}));

vi.mock('../../src/app/api/lib/ratelimit', () => ({
  clientKeyFromHeaders: vi.fn().mockReturnValue('test-client'),
  rateLimit: vi.fn().mockReturnValue({ ok: true, limit: 10, remaining: 9, retryAfterSec: 0, resetSec: 60 }),
}));

// Import the mocked function
import { makeConvex } from '../../src/app/api/lib/convex';
const mockMakeConvex = vi.mocked(makeConvex);

describe('Integration: Server-Fetch and Prompt Integration', () => {
  let mockConvexClient: any;
  let mockFetch: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    mockConvexClient = {
      query: vi.fn(),
      mutation: vi.fn(),
    };

    mockMakeConvex.mockReturnValue(mockConvexClient);

    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('Server-Fetch Mode Integration', () => {
    beforeEach(() => {
      process.env.SUMMARY_FETCH_FROM_CONVEX = '1';
    });

    afterEach(() => {
      delete process.env.SUMMARY_FETCH_FROM_CONVEX;
    });

    it('fetches and filters interactions correctly based on cutoff timestamp', async () => {
      const cutoffTime = Date.now() - 300000; // 5 minutes ago
      const recentTime = Date.now() - 60000; // 1 minute ago

      mockConvexClient.query
        .mockResolvedValueOnce({
          text: 'Previous summary',
          lastMessageTs: cutoffTime,
        }) // getLatest
        .mockResolvedValueOnce([ // listBySession
          { role: 'user', text: 'Old message before cutoff', ts: cutoffTime - 10000 },
          { role: 'assistant', text: 'Recent assistant response', ts: recentTime },
          { role: 'user', text: 'Another recent user message', ts: recentTime + 10000 },
          { role: 'system', text: 'System message', ts: recentTime + 20000 },
        ]);

      mockConvexClient.mutation.mockResolvedValue({
        id: 'summary-id',
        version: 2,
        updatedAt: Date.now()
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          text: 'Generated summary with filtered interactions'
        }),
        headers: new Headers(),
      });

      const request = new Request('http://localhost:3000/api/v1/session-summary/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'filter-test-session',
          messages: [], // Empty client messages to test server fetch
        }),
      });

      const response = await sessionSummaryPOST(request);

      expect(response.status).toBe(200);

      // Verify AI API received only recent interactions
      const fetchCall = mockFetch.mock.calls[0];
      const fetchBody = JSON.parse(fetchCall[1].body);

      expect(fetchBody.prevSummary).toBe('Previous summary');
      expect(fetchBody.messages).toHaveLength(3); // Only messages after cutoff
      expect(fetchBody.messages[0].content).toBe('Recent assistant response');
      expect(fetchBody.messages[1].content).toBe('Another recent user message');
      expect(fetchBody.messages[2].content).toBe('System message');
    });

    it('applies 40-message limit when too many recent interactions exist', async () => {
      const cutoffTime = Date.now() - 300000;
      const baseTime = Date.now() - 60000;

      // Create 50 recent interactions
      const interactions = [];
      for (let i = 0; i < 50; i++) {
        interactions.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          text: `Message ${i}`,
          ts: baseTime + (i * 1000), // Stagger timestamps
        });
      }

      mockConvexClient.query
        .mockResolvedValueOnce({ text: 'Summary', lastMessageTs: cutoffTime })
        .mockResolvedValueOnce(interactions);

      mockConvexClient.mutation.mockResolvedValue({
        id: 'summary-id',
        version: 2,
        updatedAt: Date.now()
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ text: 'Limited summary' }),
        headers: new Headers(),
      });

      const request = new Request('http://localhost:3000/api/v1/session-summary/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'limit-test-session',
          messages: [],
        }),
      });

      await sessionSummaryPOST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const fetchBody = JSON.parse(fetchCall[1].body);

      // Should limit to 40 messages (last 40 from the 50)
      expect(fetchBody.messages).toHaveLength(40);
      expect(fetchBody.messages[0].content).toBe('Message 10'); // First of the limited set
      expect(fetchBody.messages[39].content).toBe('Message 49'); // Last of the limited set
    });

    it('falls back to last 8 interactions when no cutoff exists', async () => {
      mockConvexClient.query
        .mockResolvedValueOnce(null) // No existing summary, no cutoff
        .mockResolvedValueOnce([
          { role: 'user', text: 'Old message 1', ts: Date.now() - 300000 },
          { role: 'assistant', text: 'Old message 2', ts: Date.now() - 250000 },
          { role: 'user', text: 'Recent 1', ts: Date.now() - 50000 },
          { role: 'assistant', text: 'Recent 2', ts: Date.now() - 40000 },
          { role: 'user', text: 'Recent 3', ts: Date.now() - 30000 },
          { role: 'assistant', text: 'Recent 4', ts: Date.now() - 20000 },
          { role: 'user', text: 'Recent 5', ts: Date.now() - 10000 },
          { role: 'assistant', text: 'Recent 6', ts: Date.now() - 5000 },
          { role: 'user', text: 'Most recent', ts: Date.now() - 1000 },
          { role: 'assistant', text: 'Latest', ts: Date.now() - 500 },
        ]);

      mockConvexClient.mutation.mockResolvedValue({
        id: 'summary-id',
        version: 1,
        updatedAt: Date.now()
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ text: 'Fallback summary' }),
        headers: new Headers(),
      });

      const request = new Request('http://localhost:3000/api/v1/session-summary/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'fallback-test-session',
          messages: [],
        }),
      });

      await sessionSummaryPOST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const fetchBody = JSON.parse(fetchCall[1].body);

      // Should use all interactions since cutoffTs is 0 (no existing summary)
      expect(fetchBody.messages).toHaveLength(10);
      expect(fetchBody.messages[0].content).toBe('Old message 1');
      expect(fetchBody.messages[9].content).toBe('Latest');
    });

    it('filters out invalid or empty interactions', async () => {
      const cutoffTime = Date.now() - 300000;

      mockConvexClient.query
        .mockResolvedValueOnce({ text: 'Summary', lastMessageTs: cutoffTime })
        .mockResolvedValueOnce([
          { role: 'user', text: 'Valid message', ts: Date.now() - 60000 },
          { role: '', text: 'Invalid role', ts: Date.now() - 50000 },
          { role: 'assistant', text: '', ts: Date.now() - 40000 }, // Empty text
          { role: 'user', text: 'Another valid message', ts: Date.now() - 30000 },
          null, // Null interaction
          { role: 'system', text: 'System message', ts: Date.now() - 20000 },
        ]);

      mockConvexClient.mutation.mockResolvedValue({
        id: 'summary-id',
        version: 2,
        updatedAt: Date.now()
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ text: 'Filtered summary' }),
        headers: new Headers(),
      });

      const request = new Request('http://localhost:3000/api/v1/session-summary/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'filter-invalid-test-session',
          messages: [],
        }),
      });

      await sessionSummaryPOST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const fetchBody = JSON.parse(fetchCall[1].body);

      // Should include interactions with valid content, converting non-assistant roles to 'user'
      expect(fetchBody.messages).toHaveLength(4);
      expect(fetchBody.messages[0].content).toBe('Valid message');
      expect(fetchBody.messages[1].content).toBe('Invalid role'); // Converted from empty role to 'user'
      expect(fetchBody.messages[2].content).toBe('Another valid message');
      expect(fetchBody.messages[3].content).toBe('System message'); // Converted from 'system' to 'user'
    });

    it('combines server-fetched and client-provided messages when both available', async () => {
      const cutoffTime = Date.now() - 300000;

      mockConvexClient.query
        .mockResolvedValueOnce({ text: 'Summary', lastMessageTs: cutoffTime })
        .mockResolvedValueOnce([
          { role: 'assistant', text: 'Server message 1', ts: Date.now() - 60000 },
        ]);

      mockConvexClient.mutation.mockResolvedValue({
        id: 'summary-id',
        version: 2,
        updatedAt: Date.now()
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ text: 'Combined summary' }),
        headers: new Headers(),
      });

      const request = new Request('http://localhost:3000/api/v1/session-summary/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'combine-test-session',
          messages: [
            { role: 'user', content: 'Client message 1' },
            { role: 'assistant', content: 'Client message 2' },
          ],
        }),
      });

      await sessionSummaryPOST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const fetchBody = JSON.parse(fetchCall[1].body);

      // Should prioritize server messages, then fall back to client messages
      expect(fetchBody.messages).toHaveLength(1); // Only server message since it's after cutoff
      expect(fetchBody.messages[0].content).toBe('Server message 1');
    });
  });

  describe('Prompt Integration and AI API Communication', () => {
    beforeEach(() => {
      process.env.SUMMARY_FETCH_FROM_CONVEX = '1';
    });

    it('constructs proper prompt structure for AI API', async () => {
      mockConvexClient.query.mockResolvedValue(null);
      mockConvexClient.mutation.mockResolvedValue({
        id: 'summary-id',
        version: 1,
        updatedAt: Date.now()
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ text: 'AI generated response' }),
        headers: new Headers(),
      });

      const request = new Request('http://localhost:3000/api/v1/session-summary/generate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'test-request-123'
        },
        body: JSON.stringify({
          sessionId: 'prompt-test-session',
          prevSummary: 'Previous conversation summary about goals',
          messages: [
            { role: 'user', content: 'How can I improve my skills?' },
            { role: 'assistant', content: 'Practice regularly and seek feedback.' },
          ],
          tokenBudget: 800,
        }),
      });

      await sessionSummaryPOST(request);

      // Verify AI API call structure
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];

      expect(url).toContain('/api/v1/session-summary/generate');
      expect(options.method).toBe('POST');
      expect(options.headers['content-type']).toBe('application/json');
      expect(options.headers['x-request-id']).toBe('test-request-123');

      const requestBody = JSON.parse(options.body);
      expect(requestBody).toEqual({
        sessionId: 'prompt-test-session',
        prevSummary: 'Previous conversation summary about goals',
        messages: [
          { role: 'user', content: 'How can I improve my skills?' },
          { role: 'assistant', content: 'Practice regularly and seek feedback.' },
        ],
        tokenBudget: 800,
      });
    });

    it('handles request ID propagation through the entire flow', async () => {
      mockConvexClient.query.mockResolvedValue(null);
      mockConvexClient.mutation.mockResolvedValue({
        id: 'summary-id',
        version: 1,
        updatedAt: Date.now()
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ text: 'Response with request ID' }),
        headers: new Headers(),
      });

      const requestId = 'propagate-test-456';
      const request = new Request('http://localhost:3000/api/v1/session-summary/generate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': requestId,
        },
        body: JSON.stringify({
          sessionId: 'request-id-test-session',
          messages: [{ role: 'user', content: 'Test' }],
        }),
      });

      await sessionSummaryPOST(request);

      // Verify request ID is propagated to AI API
      const fetchCall = mockFetch.mock.calls[0];
      const fetchOptions = fetchCall[1];
      expect(fetchOptions.headers['x-request-id']).toBe(requestId);
    });

    it('handles AI API response metadata and headers', async () => {
      mockConvexClient.query.mockResolvedValue(null);
      mockConvexClient.mutation.mockResolvedValue({
        id: 'summary-id',
        version: 1,
        updatedAt: Date.now()
      });

      const aiApiHeaders = new Headers();
      aiApiHeaders.set('x-summary-empty', '1');
      aiApiHeaders.set('x-provider', 'test-provider');
      aiApiHeaders.set('x-model', 'test-model');

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ text: '' }), // Empty response
        headers: aiApiHeaders,
      });

      const request = new Request('http://localhost:3000/api/v1/session-summary/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'metadata-test-session',
          messages: [{ role: 'user', content: 'Test' }],
        }),
      });

      const response = await sessionSummaryPOST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('empty');
      expect(response.headers.get('X-Summary-Empty')).toBe('1');
    });

    it('handles complex message structures with various roles', async () => {
      mockConvexClient.query.mockResolvedValue(null);
      mockConvexClient.mutation.mockResolvedValue({
        id: 'summary-id',
        version: 1,
        updatedAt: Date.now()
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ text: 'Complex message summary' }),
        headers: new Headers(),
      });

      const request = new Request('http://localhost:3000/api/v1/session-summary/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'complex-messages-test-session',
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Hello!' },
            { role: 'assistant', content: 'Hi there! How can I help?' },
            { role: 'user', content: 'Tell me about AI.' },
            { role: 'assistant', content: 'AI is fascinating...' },
            { role: 'tool', content: 'Tool result data' }, // Non-standard role
          ],
        }),
      });

      await sessionSummaryPOST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const fetchBody = JSON.parse(fetchCall[1].body);

      // Should preserve all roles and content
      expect(fetchBody.messages).toHaveLength(6);
      expect(fetchBody.messages[0]).toEqual({ role: 'system', content: 'You are a helpful assistant.' });
      expect(fetchBody.messages[1]).toEqual({ role: 'user', content: 'Hello!' });
      expect(fetchBody.messages[2]).toEqual({ role: 'assistant', content: 'Hi there! How can I help?' });
      expect(fetchBody.messages[3]).toEqual({ role: 'user', content: 'Tell me about AI.' });
      expect(fetchBody.messages[4]).toEqual({ role: 'assistant', content: 'AI is fascinating...' });
      expect(fetchBody.messages[5]).toEqual({ role: 'tool', content: 'Tool result data' });
    });

    it('gracefully handles malformed server response', async () => {
      const fixedTimestamp = Date.now();
      mockConvexClient.query
        .mockResolvedValueOnce({ text: 'Summary', lastMessageTs: fixedTimestamp })
        .mockResolvedValueOnce([
          { invalidField: 'missing role and text' },
          { role: 'user' }, // Missing text
          { text: 'Missing role' },
          { role: 'user', text: 'Valid message', ts: fixedTimestamp },
        ]);

      mockConvexClient.mutation.mockResolvedValue({
        id: 'summary-id',
        version: 2,
        updatedAt: Date.now()
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ text: 'Graceful summary' }),
        headers: new Headers(),
      });

      const request = new Request('http://localhost:3000/api/v1/session-summary/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'malformed-test-session',
          messages: [],
        }),
      });

      await sessionSummaryPOST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const fetchBody = JSON.parse(fetchCall[1].body);

      // Should only include messages with valid timestamps and content
      expect(fetchBody.messages).toHaveLength(1);
      expect(fetchBody.messages[0].content).toBe('Valid message'); // Only item with valid timestamp
    });
  });
});
