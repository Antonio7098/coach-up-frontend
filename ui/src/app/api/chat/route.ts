export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { promMetrics } from "../lib/metrics";
import { savePromptPreview } from "../lib/promptPreviewStore";
import { makeConvex } from "../lib/convex";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, X-Tracked-Skill-Id",
  // Expose provider/model so clients and benchmarks can read them
  "Access-Control-Expose-Headers": "X-Request-Id, X-Chat-Provider, X-Chat-Model",
};

function aiApiBaseUrl() {
  return (
    process.env.AI_API_BASE_URL ||
    process.env.NEXT_PUBLIC_AI_API_BASE_URL ||
    "http://127.0.0.1:8000"
  );
}

function convexBaseUrl() {
  return process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
}

function b64urlDecode(s: string): string {
  try {
    const base = s.replace(/-/g, "+").replace(/_/g, "/");
    return atob(base);
  } catch { return ""; }
}
function b64urlEncode(s: string): string {
  try { return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); } catch { return ""; }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  const controller = new AbortController();
  const url = new URL(request.url);
  const { search } = url;
  const promptParam = url.searchParams.get("prompt") || "";
  const sessionId = url.searchParams.get("sessionId") || "";
  const ridIn = url.searchParams.get("rid") || "";
  const debugOn = (process.env.PROMPT_DEBUG === "1") || (url.searchParams.get("debug") === "1");
  try {
    const prev = promptParam.slice(0, 200).replace(/\n/g, " \\n ");
    console.log(`[ui/api/chat] promptLen=%d preview="%s"`, promptParam.length, prev);
  } catch {}
  const requestId = (() => {
    try {
      const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
      const generated = g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
      return ridIn || generated;
    } catch {
      return ridIn || Math.random().toString(36).slice(2);
    }
  })();

  // Merge in server-side summary to history (as system) when available
  let upstreamUrl = `${aiApiBaseUrl()}/chat/stream${search}`;
  try {
    const clientHistParam = url.searchParams.get("history") || "";
    let historyItems: Array<{ role: string; content: string }> = [];
    if (clientHistParam) {
      try { historyItems = JSON.parse(b64urlDecode(clientHistParam)); } catch { historyItems = []; }
    }
    // Prepend summary as system if sessionId provided and summary exists
    if (sessionId) {
      try {
        const client = makeConvex(convexBaseUrl());
        const latest: any = await client.query("functions/summaries:getLatest", { sessionId });
        const summaryText: string = String(latest?.text || "").trim();
        if (summaryText) {
          const systemItem = { role: "system", content: summaryText.length > 3200 ? summaryText.slice(0, 3200) : summaryText };
          // Remove any existing system entry to avoid duplication
          historyItems = [systemItem].concat(historyItems.filter((it) => it.role !== "system"));

          const enc = b64urlEncode(JSON.stringify(historyItems));
          const params = new URLSearchParams(url.searchParams);
          params.set("history", enc);
          upstreamUrl = `${aiApiBaseUrl()}/chat/stream?${params.toString()}`;

          if (debugOn) {
            const recentPreview = historyItems.filter((it) => it.role !== "system").slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 240), len: m.content.length }));
            savePromptPreview(requestId, {
              system: "Coach-min chat",
              summary: systemItem.content.slice(0, 1000),
              summaryLen: systemItem.content.length,
              recentMessages: recentPreview,
              prompt: promptParam.slice(0, 400),
            });
          }
        } else if (debugOn) {
          savePromptPreview(requestId, { system: "Coach-min chat", summary: "", summaryLen: 0, recentMessages: historyItems.slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0,240), len: m.content.length })), prompt: promptParam.slice(0, 400) });
        }
      } catch {}
    } else if (debugOn) {
      savePromptPreview(requestId, { system: "Coach-min chat", summary: "", summaryLen: 0, recentMessages: historyItems.slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0,240), len: m.content.length })), prompt: promptParam.slice(0, 400) });
    }
  } catch {}

  // Propagate client abort to upstream
  request.signal.addEventListener("abort", () => controller.abort());

  let upstream: Response;
  try {
    const incoming = new Headers(request.headers);
    const trackedSkillId = incoming.get("x-tracked-skill-id");
    try { console.log(`[ui/api/chat] x-tracked-skill-id=%s requestId=%s`, trackedSkillId || "-", requestId); } catch {}
    const headers = new Headers({
      Accept: "text/event-stream",
      "X-Request-Id": requestId,
    });
    if (trackedSkillId) headers.set("X-Tracked-Skill-Id", trackedSkillId);
    upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
  } catch {
    return new Response("Upstream unavailable", { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response("Upstream error", { status: 502 });
  }

  const { readable, writable } = new TransformStream();

  // Measure time-to-first-byte from upstream, then pipe through
  const firstByteStart = Date.now();
  const labels = { route: "/api/chat", method: "GET", status: "200", mode: upstream.headers.get("X-Chat-Provider") || upstream.headers.get("x-chat-provider") || "-" } as const;
  const disconnectLabels = { route: "/api/chat" } as const;
  const startedAt = Date.now();
  let disconnectReason: "client_abort" | "upstream_error" | "completed" | "unknown" = "unknown";
  try {
    const [forMeasure, forPipe] = upstream.body.tee();
    const reader = forMeasure.getReader();
    // Read exactly one chunk to measure first token/byte latency
    reader.read().then(({ value, done }) => {
      try {
        promMetrics.chatFirstTokenMs.labels(labels.route, labels.method, labels.status, labels.mode as string).observe(Date.now() - firstByteStart);
      } catch {}
      // Cancel further reads so the other branch can flow
      try { reader.cancel(); } catch {}
    }).catch(() => {});

    // Pipe the other branch through to the client
    forPipe
      .pipeTo(writable)
      .then(() => { disconnectReason = "completed"; })
      .catch(() => { disconnectReason = "client_abort"; try { controller.abort(); } catch {} })
      .finally(() => {
        try {
          const totalMs = Date.now() - startedAt;
          promMetrics.requestDurationSeconds
            .labels("/api/chat", "GET", "200", (upstream.headers.get("X-Chat-Provider") || upstream.headers.get("x-chat-provider") || "-") as string)
            .observe(totalMs / 1000);
        } catch {}
        try {
          promMetrics.chatDisconnectsTotal.labels(disconnectLabels.route, disconnectReason).inc();
        } catch {}
      });
  } catch {
    // Fallback: if tee/read fails, just pipe through
    upstream.body
      .pipeTo(writable)
      .then(() => { disconnectReason = "completed"; })
      .catch(() => { disconnectReason = "client_abort"; try { controller.abort(); } catch {} })
      .finally(() => {
        try {
          const totalMs = Date.now() - startedAt;
          promMetrics.requestDurationSeconds
            .labels("/api/chat", "GET", "200", (upstream.headers.get("X-Chat-Provider") || upstream.headers.get("x-chat-provider") || "-") as string)
            .observe(totalMs / 1000);
        } catch {}
        try {
          promMetrics.chatDisconnectsTotal.labels(disconnectLabels.route, disconnectReason).inc();
        } catch {}
      });
  }

  // Build response headers, passing through provider/model if set upstream
  const respHeaders: Record<string, string> = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Explicitly prevent Next.js from buffering
    "X-Accel-Buffering": "no",
    "X-Request-Id": requestId,
    ...corsHeaders,
  };
  const upstreamProvider = upstream.headers.get("X-Chat-Provider") || upstream.headers.get("x-chat-provider");
  const upstreamModel = upstream.headers.get("X-Chat-Model") || upstream.headers.get("x-chat-model");
  if (upstreamProvider) respHeaders["X-Chat-Provider"] = upstreamProvider;
  if (upstreamModel) respHeaders["X-Chat-Model"] = upstreamModel;

  return new Response(readable, { headers: respHeaders });
}
