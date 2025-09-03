import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies first (before imports)
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

// Import after mocks
import { POST as sessionSummaryPOST } from '../../src/app/api/v1/session-summary/route';

describe('Integration: Session Summary Cadence Flow', () => {
  let mockConvexClient: any;
  let mockFetch: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    // Mock Convex client
    mockConvexClient = {
      query: vi.fn(),
      mutation: vi.fn(),
    };

    // Mock the makeConvex function to return our mock client
    mockMakeConvex.mockReturnValue(mockConvexClient);

    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('completes full cadence flow: AI API → Convex persistence → UI response', async () => {
    // Setup mocks for successful flow
    mockConvexClient.query.mockResolvedValue(null); // No existing summary
    mockConvexClient.mutation.mockResolvedValue({
      id: 'summary-id',
      version: 1,
      updatedAt: Date.now()
    });

    // Mock AI API response
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        text: 'This is a comprehensive summary of our conversation about improving clarity in communication.'
      }),
      headers: new Headers(),
    });

    // Simulate POST request
    const request = new Request('http://localhost:3000/api/v1/session-summary/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-request-123'
      },
      body: JSON.stringify({
        sessionId: 'integration-test-session',
        prevSummary: 'Previous conversation about goals',
        messages: [
          { role: 'user', content: 'How can I improve my presentation skills?' },
          { role: 'assistant', content: 'Focus on clear structure, engaging visuals, and confident delivery.' },
          { role: 'user', content: 'What about handling Q&A sessions?' },
          { role: 'assistant', content: 'Prepare for common questions and practice active listening.' }
        ],
        tokenBudget: 600,
      }),
    });

    const response = await sessionSummaryPOST(request);
    const data = await response.json();

    // Verify response structure
    expect(response.status).toBe(200);
    expect(data.status).toBe('completed');
    expect(data.summary.sessionId).toBe('integration-test-session');
    expect(data.summary.version).toBe(1);
    expect(typeof data.summary.updatedAt).toBe('number');

    // Verify AI API was called correctly
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toContain('/api/v1/session-summary/generate');

    const fetchBody = JSON.parse(fetchCall[1].body);
    expect(fetchBody.sessionId).toBe('integration-test-session');
    expect(fetchBody.prevSummary).toBe('Previous conversation about goals');
    expect(fetchBody.messages).toHaveLength(4);
    expect(fetchBody.tokenBudget).toBe(600);

    // Verify Convex persistence
    expect(mockConvexClient.mutation).toHaveBeenCalledWith('functions/summaries:insert', {
      sessionId: 'integration-test-session',
      text: 'This is a comprehensive summary of our conversation about improving clarity in communication.',
      lastMessageTs: expect.any(Number),
      meta: { tokenBudget: 600 },
    });
  });

  it('handles server-fetch mode with interaction filtering', async () => {
    // Set environment variable
    process.env.SUMMARY_FETCH_FROM_CONVEX = '1';

    // Mock existing summary
    const existingSummary = {
      text: 'Previous summary',
      lastMessageTs: Date.now() - 300000, // 5 minutes ago
    };
    mockConvexClient.query
      .mockResolvedValueOnce(existingSummary) // getLatest
      .mockResolvedValueOnce([ // listBySession with recent interactions
        {
          role: 'assistant',
          text: 'Recent assistant message',
          ts: Date.now() - 60000, // 1 minute ago
        },
        {
          role: 'user',
          text: 'Old user message',
          ts: Date.now() - 400000, // 6.7 minutes ago (should be filtered out)
        },
        {
          role: 'assistant',
          text: 'Recent assistant message 2',
          ts: Date.now() - 30000, // 30 seconds ago
        }
      ]);

    mockConvexClient.mutation.mockResolvedValue({
      id: 'summary-id',
      version: 2,
      updatedAt: Date.now()
    });

    // Mock AI API
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        text: 'Updated summary incorporating recent interactions'
      }),
      headers: new Headers(),
    });

    const request = new Request('http://localhost:3000/api/v1/session-summary/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'server-fetch-test-session',
        messages: [{ role: 'user', content: 'Client provided message' }],
      }),
    });

    const response = await sessionSummaryPOST(request);

    expect(response.status).toBe(200);

    // Verify Convex queries for server fetch
    expect(mockConvexClient.query).toHaveBeenCalledWith('functions/summaries:getLatest', {
      sessionId: 'server-fetch-test-session'
    });
    expect(mockConvexClient.query).toHaveBeenCalledWith('functions/interactions:listBySession', {
      sessionId: 'server-fetch-test-session',
      limit: 200,
    });

    // Verify AI API received filtered messages (only recent ones)
    const fetchCall = mockFetch.mock.calls[0];
    const fetchBody = JSON.parse(fetchCall[1].body);
    expect(fetchBody.prevSummary).toBe('Previous summary');
    expect(fetchBody.messages).toHaveLength(2); // Only recent interactions
    expect(fetchBody.messages[0].content).toBe('Recent assistant message');
    expect(fetchBody.messages[1].content).toBe('Recent assistant message 2');

    delete process.env.SUMMARY_FETCH_FROM_CONVEX;
  });

  it('falls back to client messages when server fetch fails', async () => {
    process.env.SUMMARY_FETCH_FROM_CONVEX = '1';

    // Mock server fetch failure
    mockConvexClient.query
      .mockResolvedValueOnce(null) // getLatest fails
      .mockRejectedValueOnce(new Error('Convex query failed')); // listBySession fails

    mockConvexClient.mutation.mockResolvedValue({
      id: 'summary-id',
      version: 1,
      updatedAt: Date.now()
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        text: 'Summary using client messages'
      }),
      headers: new Headers(),
    });

    const request = new Request('http://localhost:3000/api/v1/session-summary/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'fallback-test-session',
        messages: [
          { role: 'user', content: 'Fallback message 1' },
          { role: 'assistant', content: 'Fallback message 2' }
        ],
      }),
    });

    const response = await sessionSummaryPOST(request);

    expect(response.status).toBe(200);

    // Verify AI API still called with client messages
    const fetchCall = mockFetch.mock.calls[0];
    const fetchBody = JSON.parse(fetchCall[1].body);
    expect(fetchBody.messages).toHaveLength(2);
    expect(fetchBody.messages[0].content).toBe('Fallback message 1');
    expect(fetchBody.messages[1].content).toBe('Fallback message 2');

    delete process.env.SUMMARY_FETCH_FROM_CONVEX;
  });

  it('handles cadence state integration for version management', async () => {
    // Mock cadence state query (though not directly used in current POST implementation)
    mockConvexClient.query.mockResolvedValue(null);
    mockConvexClient.mutation.mockResolvedValue({
      id: 'summary-id',
      version: 3,
      updatedAt: Date.now()
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        text: 'Version 3 summary'
      }),
      headers: new Headers(),
    });

    const request = new Request('http://localhost:3000/api/v1/session-summary/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'version-test-session',
        messages: [{ role: 'user', content: 'Test versioning' }],
      }),
    });

    const response = await sessionSummaryPOST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary.version).toBe(3);
    expect(data.summary.updatedAt).toBeGreaterThan(0);

    // Verify Convex insert includes version management
    expect(mockConvexClient.mutation).toHaveBeenCalledWith('functions/summaries:insert', {
      sessionId: 'version-test-session',
      text: 'Version 3 summary',
      lastMessageTs: expect.any(Number),
      meta: { tokenBudget: undefined },
    });
  });

  it('handles empty AI response gracefully', async () => {
    mockConvexClient.query.mockResolvedValue(null);
    mockConvexClient.mutation.mockResolvedValue({
      id: 'summary-id',
      version: 1,
      updatedAt: Date.now()
    });

    // Mock AI API returning empty text
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ text: '' }),
      headers: new Headers(),
    });

    const request = new Request('http://localhost:3000/api/v1/session-summary/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'empty-response-test-session',
        messages: [{ role: 'user', content: 'Test message' }],
      }),
    });

    const response = await sessionSummaryPOST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('empty');
    expect(response.headers.get('X-Summary-Empty')).toBe('1');

    // Verify no Convex mutation occurred for empty response
    expect(mockConvexClient.mutation).not.toHaveBeenCalled();
  });

  it('handles AI API failure with proper error response', async () => {
    mockConvexClient.query.mockResolvedValue(null);

    // Mock AI API failure
    mockFetch.mockRejectedValue(new Error('AI API service unavailable'));

    const request = new Request('http://localhost:3000/api/v1/session-summary/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'api-failure-test-session',
        messages: [{ role: 'user', content: 'Test message' }],
      }),
    });

    const response = await sessionSummaryPOST(request);
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.error).toBe('ai generate failed');

    // Verify no Convex mutation occurred
    expect(mockConvexClient.mutation).not.toHaveBeenCalled();
  });

  it('respects token budget enforcement from environment', async () => {
    // Set minimum token budget
    process.env.AI_SUMMARY_TOKEN_BUDGET_MIN = '1000';

    mockConvexClient.query.mockResolvedValue(null);
    mockConvexClient.mutation.mockResolvedValue({
      id: 'summary-id',
      version: 1,
      updatedAt: Date.now()
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        text: 'Summary with enforced token budget'
      }),
      headers: new Headers(),
    });

    const request = new Request('http://localhost:3000/api/v1/session-summary/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'budget-test-session',
        tokenBudget: 500, // Below minimum
        messages: [{ role: 'user', content: 'Test message' }],
      }),
    });

    await sessionSummaryPOST(request);

    // Verify AI API called with enforced minimum budget
    const fetchCall = mockFetch.mock.calls[0];
    const fetchBody = JSON.parse(fetchCall[1].body);
    expect(fetchBody.tokenBudget).toBe(1000); // Should be enforced to minimum

    delete process.env.AI_SUMMARY_TOKEN_BUDGET_MIN;
  });
});
