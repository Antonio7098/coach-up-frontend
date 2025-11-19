export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { makeConvex } from "../../../../lib/convex";
import * as mockConvex from "../../../../lib/mockConvex";

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  const params = await context.params;
  const sessionId = params?.sessionId ?? "";
  const convexUrl = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
  if (!convexUrl) {
    return new Response(JSON.stringify({ error: "Missing CONVEX_URL" }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  if (!sessionId) {
    return new Response(JSON.stringify({ error: "sessionId required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  try {
    const latest = process.env.MOCK_CONVEX === '1'
      ? await mockConvex.getLatestAssessmentResults({ sessionId })
      : await ((): Promise<unknown> => {
          const client = makeConvex(convexUrl);
          return client.query("assessments:getLatestAssessmentResults", { sessionId });
        })();
    if (!latest) {
      // No results persisted yet; try to fetch the session to provide latestGroupId so UI can still render
      const client = makeConvex(convexUrl);
      try {
        const sess = await client.query("functions/sessions:getBySessionId", { sessionId });
        const latestGroupId = (sess as any)?.latestGroupId ?? null;
        return new Response(JSON.stringify({ sessionId, latestGroupId, results: null }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      } catch {
        return new Response(JSON.stringify({ sessionId, results: null }), {
          status: 404,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
    }
    return new Response(JSON.stringify(latest), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    // Fallback: if assessments query is not present, try sessions for latestGroupId before returning empty
    try { console.warn('[assessments/convex] getLatestAssessmentResults failed', e); } catch {}
    try {
      const client = makeConvex(convexUrl);
      const sess = await client.query("functions/sessions:getBySessionId", { sessionId });
      const latestGroupId = (sess as any)?.latestGroupId ?? null;
      return new Response(JSON.stringify({ sessionId, latestGroupId, results: null }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    } catch {
      return new Response(JSON.stringify({ sessionId, results: null }), {
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
  }
}


