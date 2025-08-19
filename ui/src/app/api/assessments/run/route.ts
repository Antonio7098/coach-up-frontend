export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function aiApiBaseUrl() {
  return (
    process.env.AI_API_BASE_URL ||
    process.env.NEXT_PUBLIC_AI_API_BASE_URL ||
    "http://localhost:8000"
  );
}

export async function POST(request: Request) {
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort());

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const requestId = (globalThis as any).crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2);

  let upstream: Response;
  try {
    upstream = await fetch(`${aiApiBaseUrl()}/assessments/run`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
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
    },
  });
}
