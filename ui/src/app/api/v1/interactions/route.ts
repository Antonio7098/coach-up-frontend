export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { makeConvex } from "../../lib/convex";
import * as mockConvex from "../../lib/mockConvex";
import { sha256Hex } from "../../lib/hash";
import { requireAuth } from "../../lib/auth";

type InteractionRole = 'user' | 'assistant' | 'system';
interface InteractionsBody {
  sessionId: string;
  groupId?: string;
  messageId: string;
  role: InteractionRole;
  contentHash: string;
  audioUrl?: string;
  ts: number;
  userId?: string;
}

export async function GET(request: Request) {
  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();
  const authRes = await requireAuth(request);
  if (!authRes.ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId") || "";
  const groupId = url.searchParams.get("groupId") || "";
  const limitParam = url.searchParams.get("limit");
  const limit = Math.max(1, Math.min(500, Number.isFinite(Number(limitParam)) ? Number(limitParam) : 200));

  if (!sessionId.trim() && !groupId.trim()) {
    return new Response(JSON.stringify({ error: "sessionId or groupId required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }

  const convexUrl = convexBaseUrl();
  try {
    if (process.env.MOCK_CONVEX === '1') {
      let interactions: Array<Record<string, unknown>> = [];
      if (sessionId.trim()) {
        interactions = await mockConvex.listInteractionsBySession({ sessionId, limit });
      } else {
        interactions = await mockConvex.listInteractionsByGroup({ groupId, limit });
      }
      return new Response(JSON.stringify({ interactions }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
      });
    }

    const client = makeConvex(convexUrl);
    let interactions: Array<Record<string, unknown>> = [];
    if (sessionId.trim()) {
      interactions = await client.query("functions/interactions:listBySession", { sessionId, limit }) as any;
    } else {
      interactions = await client.query("functions/interactions:listByGroup", { groupId, limit }) as any;
    }
    return new Response(JSON.stringify({ interactions }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  } catch (err: unknown) {
    try { console.error('[interactions] GET failed', err); } catch {}
    return new Response(JSON.stringify({ error: "Convex query failed" }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, X-Tracked-Skill-Id, Authorization",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function convexBaseUrl() {
  return process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
}

function aiApiBaseUrl() {
  return (
    process.env.AI_API_BASE_URL ||
    process.env.NEXT_PUBLIC_AI_API_BASE_URL ||
    "http://127.0.0.1:8000"
  );
}

function safeUUID(): string {
  try {
    // Access via unknown to avoid explicit any
    const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
    return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

export async function POST(request: Request) {
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort());

  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();
  const trackedSkillId = headersIn.get("x-tracked-skill-id") || undefined;
  const trackedSkillIdHash = trackedSkillId ? sha256Hex(trackedSkillId) : undefined;

  // Optional Clerk gating (enabled when CLERK_ENABLED=1)
  const authRes = await requireAuth(request);
  if (!authRes.ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }

  const obj = (json ?? {}) as Record<string, unknown>;
  const required = ["sessionId", "messageId", "role", "contentHash", "ts"] as const;
  for (const k of required) {
    if (obj[k] === undefined || obj[k] === null) {
      return new Response(JSON.stringify({ error: `${k} required` }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
      });
    }
  }

  // Runtime validations
  const isNonEmptyString = (v: unknown) => typeof v === 'string' ? v.trim().length > 0 : typeof v === 'number' ? String(v).trim().length > 0 : false;
  if (!isNonEmptyString(obj.sessionId)) {
    return new Response(JSON.stringify({ error: "sessionId must be a non-empty string" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }
  // groupId is optional; if provided, must be a non-empty string
  if (obj.groupId !== undefined && obj.groupId !== null && !isNonEmptyString(obj.groupId)) {
    return new Response(JSON.stringify({ error: "groupId, if provided, must be a non-empty string" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }
  if (!isNonEmptyString(obj.messageId)) {
    return new Response(JSON.stringify({ error: "messageId must be a non-empty string" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }
  const tsNum = Number(obj.ts);
  if (!Number.isFinite(tsNum) || tsNum <= 0) {
    return new Response(JSON.stringify({ error: "ts must be a positive number" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }
  if (obj.audioUrl !== undefined && obj.audioUrl !== null) {
    try {
      const u = new URL(String(obj.audioUrl));
      if (!(u.protocol === 'http:' || u.protocol === 'https:')) {
        throw new Error('invalid protocol');
      }
    } catch {
      return new Response(JSON.stringify({ error: "audioUrl must be a valid http(s) URL" }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
      });
    }
  }
  if (obj.userId !== undefined && obj.userId !== null && !isNonEmptyString(obj.userId)) {
    return new Response(JSON.stringify({ error: "userId, if provided, must be a non-empty string" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }

  const roleStr = String(obj.role);
  const isRole = (r: string): r is InteractionRole =>
    r === 'user' || r === 'assistant' || r === 'system';
  if (!isRole(roleStr)) {
    return new Response(JSON.stringify({ error: "role must be one of 'user' | 'assistant' | 'system'" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }

  const body: InteractionsBody = {
    sessionId: String(obj.sessionId),
    groupId: obj.groupId !== undefined && obj.groupId !== null ? String(obj.groupId) : undefined,
    messageId: String(obj.messageId),
    role: roleStr,
    contentHash: String(obj.contentHash),
    audioUrl: obj.audioUrl !== undefined && obj.audioUrl !== null ? String(obj.audioUrl) : undefined,
    ts: Number(obj.ts),
    userId: obj.userId !== undefined && obj.userId !== null ? String(obj.userId) : undefined,
  };

  const convexUrl = convexBaseUrl();

  try {
    const authedUserId = authRes.userId && authRes.userId !== 'anonymous' ? authRes.userId : undefined;
    const effectiveUserId = String(authedUserId || body.userId || 'unknown');
    if (process.env.MOCK_CONVEX === '1') {
      const res = await mockConvex.appendInteraction({
        sessionId: body.sessionId,
        groupId: body.groupId,
        messageId: body.messageId,
        role: body.role,
        contentHash: body.contentHash,
        audioUrl: body.audioUrl,
        ts: body.ts,
      });
      await mockConvex.logEvent({
        userId: effectiveUserId,
        sessionId: body.sessionId,
        groupId: body.groupId,
        requestId,
        trackedSkillIdHash,
        kind: 'interaction_appended',
        payload: { messageId: body.messageId, role: body.role },
      });
      // Ingest-driven cadence: on assistant message, nudge cadence state
      try {
        if (body.role === 'assistant') {
          await mockConvex.logEvent({
            userId: effectiveUserId,
            sessionId: body.sessionId,
            groupId: body.groupId,
            requestId,
            trackedSkillIdHash,
            kind: 'summary_cadence_onAssistantMessage',
            payload: { messageId: body.messageId },
          });
          // No mock Convex state; UI cadence v1 still active. This log is for observability only.
        }
      } catch {}
      return new Response(JSON.stringify({ ok: true, id: res?.id ?? null }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
      });
    }

    const client = makeConvex(convexUrl);
    const id = await client.mutation("functions/interactions:appendInteraction", {
      sessionId: body.sessionId,
      groupId: body.groupId,
      messageId: body.messageId,
      role: body.role,
      contentHash: body.contentHash,
      audioUrl: body.audioUrl,
      ts: body.ts,
    });
    await client.mutation("events:logEvent", {
      userId: effectiveUserId,
      sessionId: body.sessionId,
      groupId: body.groupId,
      requestId,
      trackedSkillIdHash,
      kind: 'interaction_appended',
      payload: { messageId: body.messageId, role: body.role },
    });

    // Ingest-driven cadence: when assistant message finalized, ask Convex to update cadence state
    if (body.role === 'assistant') {
      try {
        const cadence = await client.mutation("functions/summary_state:onAssistantMessage", { sessionId: body.sessionId });
        await client.mutation("events:logEvent", {
          userId: effectiveUserId,
          sessionId: body.sessionId,
          groupId: body.groupId,
          requestId,
          trackedSkillIdHash,
          kind: 'summary_cadence_onAssistantMessage',
          payload: { messageId: body.messageId, cadence },
        });
        // Orchestrate generation if due and lock acquired
        if (cadence?.dueNow && cadence?.locked) {
          const tokenBudget = 600;
          // Fetch latest summary for prev text and cutoff
          const latest: any = await client.query("functions/summaries:getLatest", { sessionId: body.sessionId });
          const prevSummary = String(latest?.text || "");
          const cutoffTs = Number(latest?.lastMessageTs || 0);
          // Collect recent interactions (bounded) and filter after cutoff
          let interactions: Array<any> = await client.query("functions/interactions:listBySession", { sessionId: body.sessionId, limit: 200 }) as any;
          interactions = Array.isArray(interactions) ? interactions : [];
          const recent = interactions
            .filter((d: any) => (d?.ts ?? 0) > cutoffTs)
            .map((d: any) => ({ role: d?.role === 'assistant' ? 'assistant' : 'user', content: String(d?.text || "") }))
            .filter((m: any) => m.content && m.content.trim().length > 0);
          const recentMessages = recent.length > 0 ? recent : interactions.slice(-4).map((d: any) => ({ role: d?.role === 'assistant' ? 'assistant' : 'user', content: String(d?.text || "") })).filter((m: any) => m.content && m.content.trim().length > 0);

          // Call AI API to generate summary (LLM-backed)
          let text = "";
          try {
            const res = await fetch(`${aiApiBaseUrl().replace(/\/$/, '')}/api/v1/session-summary/generate`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-request-id': requestId },
              body: JSON.stringify({ sessionId: body.sessionId, prevSummary, messages: recentMessages, tokenBudget }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(String(data?.error || res.status));
            text = String(data?.text || "");
          } catch (e) {
            // Release lock and stop if AI API fails
            try { await client.mutation("functions/summary_state:releaseLock", { sessionId: body.sessionId }); } catch {}
            throw e;
          }

          // Persist to Convex
          let inserted: any = null;
          try {
            inserted = await client.mutation("functions/summaries:insert", { sessionId: body.sessionId, text, lastMessageTs: Date.now(), meta: { tokenBudget } });
          } catch (e) {
            // Release lock if persist fails
            try { await client.mutation("functions/summary_state:releaseLock", { sessionId: body.sessionId }); } catch {}
            throw e;
          }

          // Notify cadence state of completion
          try {
            const newVersion = Number(inserted?.version || (latest?.version || 0) + 1);
            const generatedAt = Number(inserted?.updatedAt || Date.now());
            await client.mutation("functions/summary_state:onGenerated", { sessionId: body.sessionId, newVersion, generatedAt });
            await client.mutation("events:logEvent", {
              userId: effectiveUserId,
              sessionId: body.sessionId,
              groupId: body.groupId,
              requestId,
              trackedSkillIdHash,
              kind: 'summary_cadence_generated',
              payload: { version: newVersion, len: text.length },
            });
          } catch {
            // Best-effort; lock was already cleared in onGenerated
          }
        }
      } catch {}
    }

    return new Response(JSON.stringify({ ok: true, id }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Convex mutation failed" }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }
}
