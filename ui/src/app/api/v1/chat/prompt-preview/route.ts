export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getPromptPreview } from "../../../lib/promptPreviewStore";
import { devLog } from "../../../lib/observability";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rid = url.searchParams.get("rid") || url.searchParams.get("requestId") || "";
  const requestId = Math.random().toString(36).slice(2);

  devLog('debug', 'Prompt preview request initiated', {
    requestId,
    rid,
    hasRid: !!rid,
    timestamp: new Date().toISOString()
  });

  if (!rid) {
    devLog('warn', 'Prompt preview request missing rid', { requestId });
    return new Response(JSON.stringify({ error: "rid required" }), { status: 400, headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders } });
  }

  try {
    devLog('debug', 'Fetching prompt preview from store', {
      requestId,
      rid,
      fetchPhase: 'started'
    });

    const data = getPromptPreview(rid);

    if (!data) {
      devLog('info', 'Prompt preview not found', {
        requestId,
        rid,
        result: 'not_found'
      });
      return new Response(JSON.stringify({ preview: null }), { status: 404, headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders } });
    }

    devLog('info', 'Prompt preview retrieved successfully', {
      requestId,
      rid,
      previewLength: JSON.stringify(data).length || 0,
      result: 'found'
    });

    return new Response(JSON.stringify({ preview: data }), { status: 200, headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders } });
  } catch (error) {
    devLog('error', 'Prompt preview fetch failed', {
      requestId,
      rid,
      error: String(error)
    });
    return new Response(JSON.stringify({ error: "failed" }), { status: 500, headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders } });
  }
}


