export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { promMetrics } from "../lib/metrics";
import { savePromptPreview } from "../lib/promptPreviewStore";
import { makeConvex } from "../lib/convex";
import * as mockConvex from "../lib/mockConvex";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

async function getMockUserData(sessionId: string) {
  try {

    // Seed mock data if not already seeded
    mockConvex.__devSeedUserData?.();

    // First try to get userId from session
    let userId = null;
    const session = await mockConvex.getSessionById?.({ sessionId });
    if (session?.userId) {
      userId = session.userId;
    } else {
      // Fallback: try common test userIds
      const testUserIds = ['test_user', 'sales_demo', 'demo_user'];
      for (const testId of testUserIds) {
        const profile = await mockConvex.getUserProfile?.({ userId: testId });
        if (profile) {
          userId = testId;
          break;
        }
      }
    }

    if (!userId) {
      return null;
    }

    const [profile, goals] = await Promise.all([
      mockConvex.getUserProfile?.({ userId }),
      mockConvex.listUserGoals?.({ userId })
    ]);

    return { profile, goals: goals || [] };
  } catch (e) {
    console.warn('[ui/api/chat] Failed to fetch mock user data:', e);
    return null;
  }
}

function b64urlDecode(s: string): string {
  try {
    const base = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (base.length % 4)) % 4);
    return Buffer.from(base + pad, "base64").toString("utf-8");
  } catch { return ""; }
}
function b64urlEncode(s: string): string {
  try {
    return Buffer.from(s, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  } catch { return ""; }
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
  const systemPromptParam = url.searchParams.get("systemPrompt") || "";
  try {
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

  // Check if we need to fetch mock user data
  let mockUserData = null;
  const isMockMode = process.env.MOCK_CONVEX === '1';
  if (isMockMode && sessionId) {
    mockUserData = await getMockUserData(sessionId);
    if (mockUserData) {
    } else {
    }
  } else {
  }

  // Merge in server-side summary to history (as system) when available
  let upstreamUrl = `${aiApiBaseUrl()}/chat/stream${search}`;

  // Add custom system prompt parameter if provided
  if (systemPromptParam && systemPromptParam.trim().length > 0) {
    const separator = upstreamUrl.includes('?') ? '&' : '?';
    upstreamUrl += `${separator}systemPrompt=${encodeURIComponent(systemPromptParam)}`;
  }
try {
    const clientHistParam = url.searchParams.get("history") || "";
    let historyItems: Array<{ role: string; content: string }> = [];
    if (clientHistParam) {
      try { historyItems = JSON.parse(b64urlDecode(clientHistParam)); } catch { historyItems = []; }
    }
    // Prepend summary as system if sessionId provided and summary exists
    let systemItem: { role: string; content: string } | null = null;
    // Phase 2: if client already included a system summary, skip server fetch
    const clientSystem = historyItems.find((it) => it && it.role === 'system' && typeof it.content === 'string' && it.content.trim().length > 0);
    if (clientSystem) {
      try { console.log('[api/chat] client provided system summary; skip server fetch'); } catch {}
      systemItem = { role: 'system', content: clientSystem.content };
    } else if (sessionId) {
      try {
        // Use our new session-summary endpoint instead of direct Convex call
        const attemptFetch = async (): Promise<Response | null> => {
          try {
            return await fetch(`${url.origin}/api/v1/session-summary?sessionId=${encodeURIComponent(sessionId)}`, {
              headers: { 'x-request-id': requestId }
            });
          } catch { return null; }
        };
        let summaryResponse = await attemptFetch();
        if (summaryResponse) {
          try { console.log('[api/chat] summary fetch', { status: summaryResponse.status, rid: requestId, sessionId }); } catch {}
        }
        // If not found yet (race), retry once after a short delay
        if (summaryResponse && summaryResponse.status === 404) {
          try { console.warn('[api/chat] summary 404, retrying'); } catch {}
          try { await new Promise((r) => setTimeout(r, 150)); } catch {}
          summaryResponse = await attemptFetch();
          if (summaryResponse) {
            try { console.log('[api/chat] summary retry result', { status: summaryResponse.status }); } catch {}
          }
        }
        if (summaryResponse && summaryResponse.ok) {
          const summaryData = await summaryResponse.json();
          // Our session-summary endpoint returns the latest text at the top level as `text`
          const summaryText: string = String(summaryData?.text || summaryData?.summary?.text || "").trim();
          try { console.log('[api/chat] summary ok', { len: summaryText.length }); } catch {}
          if (summaryText) {
            systemItem = { role: "system", content: summaryText.length > 3200 ? summaryText.slice(0, 3200) : summaryText };
            // Remove any existing system entry to avoid duplication
            historyItems = [systemItem].concat(historyItems.filter((it) => it.role !== "system"));

            const enc = b64urlEncode(JSON.stringify(historyItems));
            const params = new URLSearchParams(url.searchParams);
            params.set("history", enc);

            // Include mock user data if available
            if (mockUserData) {
              const userDataEnc = b64urlEncode(JSON.stringify(mockUserData));
              params.set("mockUserData", userDataEnc);
            }

            upstreamUrl = `${aiApiBaseUrl()}/chat/stream?${params.toString()}`;
          } else if (mockUserData) {
            // No summary but we have mock user data
            const params = new URLSearchParams(url.searchParams);
            const userDataEnc = b64urlEncode(JSON.stringify(mockUserData));
            params.set("mockUserData", userDataEnc);
            upstreamUrl = `${aiApiBaseUrl()}/chat/stream?${params.toString()}`;
          }
        }
      } catch (error) {
        console.error("Error fetching summary:", error);
      }
    }

    if (debugOn) {
      const recentPreview = historyItems.filter((it) => it.role !== "system").slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 240), len: m.content.length }));
      const summaryText = systemItem ? (systemItem as { role: string; content: string }).content : "";
      savePromptPreview(requestId, {
        system: "Coach-min chat",
        summary: summaryText.slice(0, 1000),
        summaryLen: summaryText.length,
        recentMessages: recentPreview,
        prompt: promptParam.slice(0, 400),
      });
    }
  } catch (error) {
    console.error("Error in chat route:", error);
  }

  // Do NOT propagate client abort to upstream; we want upstream to finish so we can persist and trigger summaries.
  // If the client disconnects, we'll stop piping to the client but keep consuming upstream.

  let upstream: Response | null = null;
  let selectedModel: string | null = null;
  try {
    const incoming = new Headers(request.headers);
    const trackedSkillId = incoming.get("x-tracked-skill-id");
    const headers = new Headers({
      Accept: "text/event-stream",
      "X-Request-Id": requestId,
    });
    if (trackedSkillId) headers.set("X-Tracked-Skill-Id", trackedSkillId);

    async function attempt(urlStr: string): Promise<Response | null> {
      try {
        const res = await fetch(urlStr, { method: 'GET', headers, signal: controller.signal });
        if (res.ok && res.body) return res;
        return null;
      } catch {
        return null;
      }
    }

    // First attempt with whatever model is in upstreamUrl
    const u1 = new URL(upstreamUrl);
    const modelParam = u1.searchParams.get('model') || '';
    selectedModel = modelParam || null;
    upstream = await attempt(u1.toString());

    // If failed, try alternate Gemini model (flash-lite <-> flash)
    if (!upstream) {
      let alt: string | null = null;
      if (modelParam.includes('gemini-2.5-flash-lite')) alt = 'gemini-2.5-flash';
      else if (modelParam.includes('gemini-2.5-flash')) alt = 'gemini-2.5-flash-lite';

      if (alt) {
        try { console.warn('[api/chat] primary model failed, retrying with alternate', { from: modelParam || '(none)', to: alt }); } catch {}
        u1.searchParams.set('model', alt);
        selectedModel = alt;
        upstream = await attempt(u1.toString());
      }
    }

    if (!upstream) {
      // Option: could fall back to non-streaming here if your AI API exposes it.
      try { console.warn('[api/chat] all streaming attempts failed'); } catch {}
      return new Response('Model is currently busy. Please try again.', { status: 503, headers: { ...corsHeaders, 'X-Request-Id': requestId } });
    }
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
      .pipeTo(writable, { preventCancel: true })
      .then(() => { disconnectReason = "completed"; })
      .catch(() => { disconnectReason = "client_abort"; /* do not abort upstream */ })
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
      .pipeTo(writable, { preventCancel: true })
      .then(() => { disconnectReason = "completed"; })
      .catch(() => { disconnectReason = "client_abort"; /* do not abort upstream */ })
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

// New: POST endpoint to accept JSON body (prompt, sessionId, historyItems, etc.) and stream SSE
export async function POST(request: Request) {
  const controller = new AbortController();
  const url = new URL(request.url);
  const ridIn = url.searchParams.get("rid") || "";
  const requestId = (() => {
    try {
      const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
      const generated = g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
      return ridIn || generated;
    } catch {
      return ridIn || Math.random().toString(36).slice(2);
    }
  })();

  let bodyIn: any = null;
  try { bodyIn = await request.json(); } catch {}
  if (!bodyIn || typeof bodyIn !== 'object') {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } });
  }

  const promptParam: string = String(bodyIn.prompt || "");
  const sessionId: string = String(bodyIn.sessionId || "");
  const systemPromptParam: string = String(bodyIn.systemPrompt || bodyIn.customSystemPrompt || "");
  const debugOn = (process.env.PROMPT_DEBUG === "1") || Boolean(bodyIn.debug);

  // Build history items from either explicit array or base64 input
  const clientHistoryItems: Array<{ role: string; content: string }> = Array.isArray(bodyIn.historyItems)
    ? bodyIn.historyItems.filter((it: any) => it && typeof it.role === 'string' && typeof it.content === 'string')
    : [];

  // Build history items - the AI API will handle system prompt generation with profile/goals/skills
  let historyItems = clientHistoryItems;
  // Remove any client system items - let the AI API build the proper system prompt
  historyItems = historyItems.filter((it) => it.role !== 'system');
  
  // Fetch session summary to pass as context (ctx parameter)
  let summaryTextForCtx = '';
  if (sessionId) {
    try {
      const attemptFetch = async (): Promise<Response | null> => {
        try {
          return await fetch(`${url.origin}/api/v1/session-summary?sessionId=${encodeURIComponent(sessionId)}`, {
            headers: { 'x-request-id': requestId }
          });
        } catch { return null; }
      };
      let summaryResponse = await attemptFetch();
      if (summaryResponse && summaryResponse.status === 404) {
        try { await new Promise((r) => setTimeout(r, 150)); } catch {}
        summaryResponse = await attemptFetch();
      }
      if (summaryResponse && summaryResponse.ok) {
        const summaryData = await summaryResponse.json();
        const summaryText: string = String(summaryData?.text || summaryData?.summary?.text || "").trim();
        if (summaryText) {
          summaryTextForCtx = summaryText;
        }
      }
    } catch {}
  }
  
  // If there are no user/assistant items (only system), backfill from Convex to avoid empty first-turn context after refresh
  {
    const nonSystemCount = Array.isArray(historyItems) ? historyItems.filter((it: any) => it && it.role !== 'system').length : 0;
    if (nonSystemCount === 0 && sessionId) {
      try {
        const headers = new Headers({ accept: 'application/json', 'x-request-id': requestId });
        // Fetch a small tail of interactions
        const res = await fetch(`${url.origin}/api/v1/interactions?sessionId=${encodeURIComponent(sessionId)}&limit=10`, { method: 'GET', headers, cache: 'no-store' });
        const data = await res.json().catch(() => ({} as any));
        if (res.ok && Array.isArray(data?.interactions)) {
          const fromServer = data.interactions
            .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
            .map((m: any) => ({ role: m.role, content: String(m.text || '').slice(0, 240) }));
        if (fromServer.length > 0) {
            // Use only user/assistant turns; system is handled by the AI API
            historyItems = fromServer;
          }
        }
      } catch {}
    }
  }

  // Prepare upstream URL - let AI API handle system prompt with profile/goals/skills
  const params = new URLSearchParams();
  
  // Build context (ctx) in the format the AI API expects
  let ctxParts: string[] = [];
  if (summaryTextForCtx) {
    ctxParts.push(`Session summary:\n${summaryTextForCtx}`);
  }
  // Add recent history as context (fallback for providers that use ctx)
  if (historyItems.length > 0) {
    const recentTurns = historyItems.slice(-4).map(m => `${m.role.charAt(0)}: ${m.content}`).join('\n');
    if (recentTurns) {
      ctxParts.push(`Recent turns:\n${recentTurns}`);
    }
  }
  const ctx = ctxParts.join('\n\n');
  
  // Set parameters in format AI API expects
  params.set('prompt', promptParam);
  if (sessionId) params.set('sessionId', sessionId);
  if (ctx) params.set('ctx', ctx);
  
  // Pass actual recent history so the AI API can reconstruct turns
  try {
    const historyPayload = historyItems
      .filter((it: any) => it && (it.role === 'user' || it.role === 'assistant') && typeof it.content === 'string')
      .map((it: any) => ({ role: it.role, content: it.content }));
    params.set('history', b64urlEncode(JSON.stringify(historyPayload)));
  } catch {
    // On any failure, fall back to empty history
    params.set('history', b64urlEncode(JSON.stringify([])));
  }
  
  // Pass user profile and goals for AI API to build system prompt
  if (bodyIn.userProfile) {
    try { params.set('userProfile', b64urlEncode(JSON.stringify(bodyIn.userProfile))); } catch {}
  }
  if (Array.isArray(bodyIn.userGoals)) {
    try { params.set('userGoals', b64urlEncode(JSON.stringify(bodyIn.userGoals))); } catch {}
  }
  if (bodyIn.model) {
    try { params.set('model', String(bodyIn.model)); } catch {}
  }
  
  // Pass custom system prompt if provided (AI API will append profile/goals/skills)
  if (systemPromptParam && systemPromptParam.trim().length > 0) {
    params.set('systemPrompt', systemPromptParam.trim());
  }
  
  if (debugOn) {
    params.set('debug', '1');
  }
  const upstreamUrl = `${aiApiBaseUrl()}/chat/stream?${params.toString()}`;

  // Save prompt preview if debug enabled
  if (debugOn) {
    try {
      const recentPreview = historyItems.slice(-6).map((m) => ({ role: m.role, content: (m.content || '').slice(0, 240), len: (m.content || '').length }));
      savePromptPreview(requestId, {
        system: "Coach-min chat (delegated to AI API)",
        summary: summaryTextForCtx.slice(0, 1000),
        summaryLen: summaryTextForCtx.length,
        recentMessages: recentPreview,
        prompt: promptParam.slice(0, 400),
      });
    } catch {}
  }

  // Proxy to upstream SSE and pipe through
  let upstream: Response;
  try {
    const incoming = new Headers(request.headers);
    const trackedSkillId = incoming.get("x-tracked-skill-id");
    const headers = new Headers({
      Accept: "text/event-stream",
      "X-Request-Id": requestId,
    });
    if (trackedSkillId) headers.set("X-Tracked-Skill-Id", trackedSkillId);
    upstream = await fetch(upstreamUrl, { method: 'GET', headers, signal: controller.signal });
  } catch {
    return new Response("Upstream unavailable", { status: 502, headers: corsHeaders });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response("Upstream error", { status: 502, headers: corsHeaders });
  }

  // Build a merged ReadableStream that emits a prompt preview event (if debug)
  // and then proxies the upstream SSE stream.
  const enc = new TextEncoder();
  const firstByteStart = Date.now();
  const labels = { route: "/api/chat", method: "POST", status: "200", mode: upstream.headers.get("X-Chat-Provider") || upstream.headers.get("x-chat-provider") || "-" } as const;
  const disconnectLabels = { route: "/api/chat" } as const;
  const startedAt = Date.now();

  const upstreamReader = upstream.body.getReader();
  let measured = false;
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (debugOn) {
          const preview = {
            system: "Delegated to AI API",
            rendered: ctx ? `ctx: ${ctx}\nmsg: ${promptParam}` : promptParam || "",
            user: promptParam || "",
          };
          try {
            console.log('[api/chat:POST] enqueue prompt event', {
              rid: requestId,
              sessionId,
              sysLen: (preview.system || '').length,
              renderedLen: (preview.rendered || '').length,
            });
          } catch {}
          controller.enqueue(enc.encode(`event: prompt\n`));
          controller.enqueue(enc.encode(`data: ${JSON.stringify(preview)}\n\n`));
        }
        let chunkCount = 0;
        while (true) {
          const { value, done } = await upstreamReader.read();
          if (done) break;
          if (!measured) {
            try { promMetrics.chatFirstTokenMs.labels(labels.route, labels.method, labels.status, labels.mode as string).observe(Date.now() - firstByteStart); } catch {}
            measured = true;
          }
          if (value) {
            chunkCount++;
            if (chunkCount === 1) {
              try { console.log('[api/chat:POST] first upstream chunk', { rid: requestId, bytes: value.byteLength }); } catch {}
            }
            controller.enqueue(value);
          }
        }
        try { console.log('[api/chat:POST] upstream completed', { rid: requestId, chunks: chunkCount }); } catch {}
      } catch (e) {
        // swallow
      } finally {
        try {
          const totalMs = Date.now() - startedAt;
          promMetrics.requestDurationSeconds.labels("/api/chat", "POST", "200", (upstream.headers.get("X-Chat-Provider") || upstream.headers.get("x-chat-provider") || "-") as string).observe(totalMs / 1000);
        } catch {}
        try { promMetrics.chatDisconnectsTotal.labels(disconnectLabels.route, measured ? "completed" : "client_abort").inc(); } catch {}
        controller.close();
      }
    }
  });

  const respHeaders: Record<string, string> = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
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
