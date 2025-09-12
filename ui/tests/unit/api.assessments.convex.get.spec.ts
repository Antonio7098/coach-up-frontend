import { describe, it, expect, beforeEach } from 'vitest';
import { GET as getLatest } from '../../src/app/api/assessments/convex/[sessionId]/route';
import { getLatestConvexClientMock, setConvexMockBehavior } from '../setup.vitest';

const ctx = (sessionId: string) => ({ params: { sessionId } });

describe('API: GET /api/assessments/convex/[sessionId]', () => {
  beforeEach(() => {
    setConvexMockBehavior({ queryReturn: undefined, queryThrow: null, mutationReturn: undefined, mutationThrow: null });
    delete (process.env as any).CONVEX_URL;
    delete (process.env as any).NEXT_PUBLIC_CONVEX_URL;
  });

  it('returns 404 when no latest summary', async () => {
    // Mock both queries to return null so route falls back to 404
    setConvexMockBehavior({
      queryReturn: null,
      mutationReturn: null
    });

    // Override the client mock to ensure both queries return null
    const mockClient = getLatestConvexClientMock();
    if (mockClient) {
      mockClient.query = vi.fn().mockResolvedValue(null);
    }

    const res = await getLatest(new Request('http://localhost:3000'), ctx('s_get_1'));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ sessionId: 's_get_1', summary: null });
  });

  it('returns latest summary when present', async () => {
    const latest = { sessionId: 's_get_2', groupId: 'g_get_2', summary: { highlights: ['a'], recommendations: [], rubricKeyPoints: [] } };
    setConvexMockBehavior({ queryReturn: latest });
    const res = await getLatest(new Request('http://localhost:3000'), ctx('s_get_2'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(latest);

    const client = getLatestConvexClientMock();
    expect(client).toBeTruthy();
    expect(client.url).toBe('http://127.0.0.1:3210');
  });

  it('handles Convex errors gracefully with 404', async () => {
    setConvexMockBehavior({ queryThrow: new Error('convex down') });
    const res = await getLatest(new Request('http://localhost:3000'), ctx('s_get_3'));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ sessionId: 's_get_3', summary: null });
  });
});
