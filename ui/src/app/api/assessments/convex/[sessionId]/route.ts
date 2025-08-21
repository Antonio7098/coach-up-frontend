export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { ConvexHttpClient } from "convex/browser";
import * as mockConvex from "../../../lib/mockConvex";

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = (await context.params) || ({ sessionId: "" } as any);
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
      ? await mockConvex.getLatestAssessmentSummary({ sessionId })
      : await new ConvexHttpClient(convexUrl).query("assessments:getLatestAssessmentSummary" as any, { sessionId });
    if (!latest) {
      return new Response(JSON.stringify({ sessionId, summary: null }), {
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    return new Response(JSON.stringify(latest), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Convex query failed" }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
