import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST as ingestPOST, OPTIONS as ingestOPTIONS } from '../../src/app/api/messages/ingest/route';

function jsonRequest(url: string, body: any, headers?: Record<string, string>) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: JSON.stringify(body),
  });
}

describe('API: /api/messages/ingest proxy', () => {
  const ORIGINAL_ENV = { ...process.env } as any;
  let fetchMock: any;

  beforeEach(() => {
    // default AI API base URL
    delete (process.env as any).AI_API_BASE_URL;
    delete (process.env as any).NEXT_PUBLIC_AI_API_BASE_URL;

    fetchMock = vi.fn(async (_url: string, init?: any) => {
      // echo body for verification
      const buf = init?.body ? Buffer.from(init.body) : Buffer.from('');
      return new Response(JSON.stringify({ ok: true, echoed: buf.toString('utf-8') }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV } as any;
  });

  it('OPTIONS returns CORS headers', async () => {
    const res = await ingestOPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-Request-Id');
  });

  it('POST proxies body and sets/propagates X-Request-Id', async () => {
    const body = { sessionId: 's_ing1', messageId: 'm1', role: 'user', content: 'plan my next two weeks' };
    const reqId = 'req-123';
    const req = jsonRequest('http://localhost:3000/api/messages/ingest', body, { 'X-Request-Id': reqId });

    const res = await ingestPOST(req);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8000/messages/ingest');
    // upstream headers include the same X-Request-Id
    expect(new Headers(init.headers).get('x-request-id')).toBe(reqId);
    // upstream receives same bytes
    const upstreamBody = Buffer.from(init.body).toString('utf-8');
    expect(() => JSON.parse(upstreamBody)).not.toThrow();
    expect(JSON.parse(upstreamBody)).toEqual(body);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-Id')).toBe(reqId);
    const json = await res.json();
    expect(json).toHaveProperty('ok', true);
  });

  it('POST generates a request id when absent and returns upstream error 502 when fetch throws', async () => {
    (fetch as any).mockImplementationOnce(async () => { throw new Error('down'); });

    const req = jsonRequest('http://localhost:3000/api/messages/ingest', { sessionId: 's', messageId: 'm', role: 'user' });
    const res = await ingestPOST(req);

    expect(res.status).toBe(502);
    expect(await res.text()).toBe('Upstream unavailable');
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });

  it('respects AI_API_BASE_URL override', async () => {
    (process.env as any).AI_API_BASE_URL = 'http://127.0.0.1:9999';
    const req = jsonRequest('http://localhost:3000/api/messages/ingest', { sessionId: 's2', messageId: 'm2', role: 'assistant', content: 'Good luck!' });
    await ingestPOST(req);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:9999/messages/ingest');
  });
});
