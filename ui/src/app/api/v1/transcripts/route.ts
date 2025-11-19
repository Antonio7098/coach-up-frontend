 
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireAuth } from "../../lib/auth";
import { promMetrics } from "../../lib/metrics";
import { makeConvex } from "../../lib/convex";
import * as mockConvex from "../../lib/mockConvex";
import { devLog } from "../../lib/observability";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

export async function GET(request: Request) {
  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();
  const routePath = "/api/v1/transcripts";
  const method = "GET";
  const started = Date.now();
  const mode = process.env.MOCK_CONVEX === '1' ? 'mock' : 'convex';
  const endTimer = promMetrics.requestDurationSeconds.startTimer();

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId") || "";
  const groupId = url.searchParams.get("groupId") || "";

  devLog("debug", "transcripts: GET request initiated", {
    requestId,
    sessionId,
    groupId,
    mode,
    timestamp: new Date().toISOString()
  });

  function respond(status: number, body: unknown) {
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
  }

  // Auth (optional gating via CLERK_ENABLED)
  const auth = await requireAuth(request);
  if (!auth.ok) {
    devLog("warn", "transcripts: authentication failed", { requestId, status: 401, reason: auth.reason, latencyMs: Date.now() - started });
    return respond(401, { error: "Unauthorized" });
  }

  const limitRaw = url.searchParams.get("limit");
  const cursor = url.searchParams.get("cursor") || undefined;

  if (!sessionId || sessionId.trim().length === 0) {
    devLog("warn", "transcripts: missing sessionId", { requestId, status: 400, latencyMs: Date.now() - started });
    return respond(400, { error: "sessionId is required" });
  }

  let limit = 20;
  if (limitRaw) {
    const n = Number(limitRaw);
    if (Number.isFinite(n)) {
      limit = Math.max(1, Math.min(100, Math.trunc(n)));
    }
  }

  try {
    // Fetch underlying interaction rows to serve as transcript items (text may be populated by STT later)
    let docs: Array<Record<string, any>> = [];
    if (mode === 'mock') {
      if (groupId) {
        docs = await mockConvex.listInteractionsByGroup({ groupId, limit }) as any[];
      } else if (sessionId) {
        docs = await mockConvex.listInteractionsBySession({ sessionId, limit }) as any[];
      }
    } else {
      const convexUrl = convexBaseUrl();
      const client = makeConvex(convexUrl);

      // Add timeout to prevent hanging queries (30 second timeout)
      const queryTimeout = 30000; // 30 seconds
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Convex query timeout')), queryTimeout);
      });

      try {
        if (groupId) {
          docs = await Promise.race([
            client.query("functions/interactions:listByGroup", { groupId, limit }),
            timeoutPromise
          ]) as any[];
        } else if (sessionId) {
          docs = await Promise.race([
            client.query("functions/interactions:listBySession", { sessionId, limit }),
            timeoutPromise
          ]) as any[];
        }
      } catch (queryError: any) {
        // If query times out or fails, log and continue with empty docs
        try {
          devLog("warn", "transcripts: Convex query failed", {
            sessionId,
            groupId,
            requestId,
            error: queryError.message,
            mode
          });
        } catch {}
        docs = []; // Ensure we have an empty array
      }
    }

    // Map to public transcript item shape
    const items = (docs || []).map((d) => ({
      id: d.messageId ?? `${d.sessionId}:${d.ts ?? d.createdAt ?? ''}`,
      sessionId: d.sessionId,
      groupId: d.groupId,
      role: d.role ?? null,
      text: d.text ?? null,
      audioUrl: d.audioUrl ?? null,
      // Surface triage metadata when present
      assessmentType: d.assessmentType ?? undefined,
      triageStatus: d.triageStatus ?? undefined,
      triageDecision: d.triageDecision ?? undefined,
      triageProcessedAt: typeof d.triageProcessedAt === 'number' ? d.triageProcessedAt : undefined,
      createdAt: d.createdAt ?? d.ts ?? Date.now(),
    }));

    const payload = {
      items,
      ...(cursor ? { nextCursor: undefined } : {}),
    } as const;

    // Debug: role breakdown for returned items
    try {
      const roleCounts = items.reduce((acc: Record<string, number>, it: any) => {
        const r = (it.role || 'unknown') as string;
        acc[r] = (acc[r] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      devLog("info", "transcripts: 200 OK response", {
        requestId,
        status: 200,
        sessionId,
        groupId,
        limit,
        mode,
        itemsReturned: items.length,
        roleCounts,
        latencyMs: Date.now() - started
      });
    } catch {
      devLog("info", "transcripts: 200 OK response (fallback)", {
        requestId,
        status: 200,
        sessionId,
        groupId,
        limit,
        mode,
        itemsReturned: items.length,
        latencyMs: Date.now() - started
      });
    }
    return respond(200, payload);
  } catch (err: unknown) {
    devLog("error", "transcripts: GET failed", { sessionId, groupId, requestId, error: String(err), mode });
    return respond(502, { error: "Backend query failed" });
  }
}

function convexBaseUrl() {
  return process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
}
