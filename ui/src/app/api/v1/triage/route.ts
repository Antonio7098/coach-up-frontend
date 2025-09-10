/* eslint-disable no-console */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireAuth } from "../../lib/auth";
import { promMetrics } from "../../lib/metrics";
import { makeConvex } from "../../lib/convex";
import * as mockConvex from "../../lib/mockConvex";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, Authorization",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function safeUUID(): string {
  try {
    const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
    return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

function convexBaseUrl() {
  return process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
}

export async function POST(request: Request) {
  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();
  const routePath = "/api/v1/triage";
  const method = "POST";
  const mode = process.env.MOCK_CONVEX === '1' ? 'mock' : 'convex';
  const endTimer = promMetrics.requestDurationSeconds.startTimer();

  const respond = (status: number, body: unknown) => {
    const labels = { route: routePath, method, status: String(status), mode } as const;
    promMetrics.requestsTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    if (status >= 500) {
      promMetrics.requestErrorsTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    }
    endTimer(labels);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  };

  // Feature gate
  const enabled = String(process.env.AI_TRIAGE_ENABLED || "").toLowerCase();
  if (!(enabled === '1' || enabled === 'true')) {
    return respond(404, { error: "triage disabled" });
  }

  // Optional auth gating via CLERK_ENABLED
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return respond(401, { error: "Unauthorized" });
  }

  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId") || "";
    const limitParam = url.searchParams.get("limit");
    const cutoffParam = url.searchParams.get("cutoffIndex");
    const limit = Math.max(1, Math.min(200, Number.isFinite(Number(limitParam)) ? Number(limitParam) : 20));
    const cutoffOverride = Number.isFinite(Number(cutoffParam)) ? Number(cutoffParam) : undefined;
    if (!sessionId) return respond(400, { error: "sessionId is required" });

    if (mode === 'mock') {
      // In mock mode, call a mockConvex helper if desired; otherwise, just ACK with 0 updated
      return respond(200, { updated: 0, inferred: "general_chatter", mode: 'mock' });
    }

    const client = makeConvex(convexBaseUrl());

    // Decide where to perform triage: outside Convex (here) or inside Convex action.
    const providerUi = String(process.env.TRIAGE_PROVIDER || process.env.NEXT_PUBLIC_TRIAGE_PROVIDER || '').toLowerCase();
    const aiBase = String(process.env.AI_API_BASE_URL || process.env.NEXT_PUBLIC_AI_API_BASE_URL || '');

    if (providerUi === 'external' && aiBase) {
      const since0 = Date.now();
      // 1) Gather messageIds for this session
      const interactions = await client.query("functions/triage:listBySession", { sessionId }) as any[];
      // Optional: align with provided cutoffIndex (from reservation) or latest summary cutoff
      let cutoffIndex: number | undefined = cutoffOverride;
      if (cutoffIndex === undefined) {
        try {
          const latest: any = await client.query("functions/summaries:getLatest", { sessionId }).catch(() => null);
          const cut = Number(latest?.cutoffIndex);
          if (Number.isFinite(cut)) cutoffIndex = cut as number;
        } catch {}
      }

      let recent = interactions;
      if (typeof cutoffIndex === 'number') {
        recent = interactions.map((d, i) => ({ i, d })).filter(({ i }) => i > cutoffIndex!).map(({ d }) => d);
      }
      if (recent.length > limit) recent = recent.slice(-limit);
      const messageIds = recent.map((d: any) => String(d?.messageId || ''));

      const url = aiBase.replace(/\/$/, '') + '/triage/batch';
      let json: any = null;
      let status = 0;
      let tookMs = 0;
      try {
        const t0 = Date.now();
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, batchSize: limit, cutoffIndex, messageIds }),
        } as RequestInit);
        tookMs = Date.now() - t0;
        const text = await res.text();
        status = res.status;
        try { json = JSON.parse(text); } catch { json = {}; }
        try {
          console.log(JSON.stringify({ where: 'ui.api.triage.externalResponse', sessionId, status, tookMs, url, textPreview: String(text).slice(0, 300) }));
        } catch {}
        if (!res.ok) throw new Error(`AI API non-200: ${res.status}`);
      } catch (e) {
        // Fallback: call Convex action (may run mock)
        const took0 = Date.now();
        const fallbackRes = await (client as any).action("functions/triage:runForSession", { sessionId, limit }) as any;
        const tookMsFb = Date.now() - took0;
        try {
          console.warn(JSON.stringify({ where: 'ui.api.triage.externalError', sessionId, error: String(e), fallbackProvider: fallbackRes?.provider, updated: fallbackRes?.updated, tookMs: tookMsFb }));
        } catch {}
        return respond(200, { updated: Number(fallbackRes?.updated || 0), inferred: fallbackRes?.inferred || null, provider: fallbackRes?.provider || 'mock_fallback', modelId: fallbackRes?.modelId || null, tookMs: tookMsFb, mode: 'fallback' });
      }

      // Persist updates back to Convex
      const updatesArr: any[] = Array.isArray(json?.updates) ? json.updates : [];
      const updates = updatesArr.map((u) => ({
        sessionId,
        messageId: String(u?.messageId || ''),
        assessmentType: String(u?.assessmentType || 'unknown') as any,
        ...(u?.groupId ? { groupId: String(u.groupId) } : {}),
      }));

      let persisted: any = { updated: 0 };
      if (updates.length > 0) {
        persisted = await client.mutation("functions/triage:setResults", { updates });
      }

      try {
        console.log(JSON.stringify({ where: 'ui.api.triage.external.persisted', sessionId, limit, convexUrl: convexBaseUrl(), provider: 'external', modelId: json?.modelId || null, updatesLen: updates.length, updated: persisted?.updated || 0, tookMs, endToEndMs: Date.now() - since0 }));
      } catch {}

      return respond(200, { updated: Number(persisted?.updated || 0), inferred: null, provider: String(json?.provider || 'external'), modelId: typeof json?.modelId === 'string' ? json.modelId : null, tookMs });
    }

    // Default path: run inside Convex (may be mock or external depending on Convex env)
    const took0 = Date.now();
    const res = await (client as any).action("functions/triage:runForSession", { sessionId, limit }) as any;
    const tookMs = Date.now() - took0;
    try {
      console.log(JSON.stringify({ where: 'ui.api.triage', sessionId, limit, convexUrl: convexBaseUrl(), result: { updated: res?.updated, inferred: res?.inferred, provider: res?.provider, modelId: res?.modelId, tookMs } }));
    } catch {}
    return respond(200, { updated: Number(res?.updated || 0), inferred: res?.inferred || null, provider: res?.provider || null, modelId: res?.modelId || null, tookMs });
  } catch (err: unknown) {
    try { console.error('[triage] POST failed', err); } catch {}
    return respond(502, { error: "Convex action failed" });
  }
}
