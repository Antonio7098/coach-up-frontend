export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort());

  const { sessionId } = await context.params;
  const requestId = (() => {
    try {
      const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
      return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    } catch {
      return Math.random().toString(36).slice(2);
    }
  })();

  let upstream: Response;
  try {
    const incoming = new Headers(request.headers);
    const trackedSkillId = incoming.get("x-tracked-skill-id");
    const headers = new Headers({
      Accept: "application/json",
      "X-Request-Id": requestId,
    });
    if (trackedSkillId) headers.set("X-Tracked-Skill-Id", trackedSkillId);
    upstream = await fetch(`${aiApiBaseUrl()}/assessments/${encodeURIComponent(sessionId)}` , {
      method: "GET",
      headers,
      signal: controller.signal,
    });
  } catch {
    return new Response("Upstream unavailable", { status: 502 });
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
