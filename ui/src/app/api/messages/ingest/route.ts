export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, X-Tracked-Skill-Id",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

function aiApiBaseUrl() {
  return (
    process.env.AI_API_BASE_URL ||
    process.env.NEXT_PUBLIC_AI_API_BASE_URL ||
    "http://127.0.0.1:8000"
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort());

  // Pass-through original request body as bytes to preserve JSON exactly
  const headers = new Headers(request.headers);
  const requestId = headers.get("x-request-id") || (() => {
    try {
      const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
      return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    } catch {
      return Math.random().toString(36).slice(2);
    }
  })();
  headers.set("X-Request-Id", requestId);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const bodyBytes = await request.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(`${aiApiBaseUrl()}/messages/ingest`, {
      method: "POST",
      headers,
      body: bodyBytes,
      signal: controller.signal,
    });
  } catch {
    return new Response("Upstream unavailable", {
      status: 502,
      headers: {
        "X-Request-Id": requestId,
        ...corsHeaders,
      },
    });
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ||
        "application/json; charset=utf-8",
      "X-Accel-Buffering": "no",
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
      ...corsHeaders,
    },
  });
}
