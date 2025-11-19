export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { makeConvex } from "../../lib/convex";
import * as mockConvex from "../../lib/mockConvex";
import { sha256Hex } from "../../lib/hash";
import { requireAuth } from "../../lib/auth";
import { promMetrics } from "../../lib/metrics";
import { createHash } from "crypto";
import { generateSummaryText } from "../../lib/summarizer";
import { getLatestSummary, upsertSummary } from "../../lib/summaries";
import { getEnvString, getEnvBool } from "../../lib/env";
import { devLog } from "../../lib/observability";

type InteractionRole = 'user' | 'assistant' | 'system';
interface InteractionsBody {
  sessionId: string;
  groupId?: string;
  messageId: string;
  role: InteractionRole;
  contentHash: string;
  audioUrl?: string;
  text?: string;
  ts: number;
  userId?: string;
}

export async function GET(request: Request) {
  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();
  const startTime = Date.now();
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId") || "";
  const groupId = url.searchParams.get("groupId") || "";
  const sinceId = url.searchParams.get("sinceId") || "";

  devLog("debug", "interactions: GET request initiated", {
    requestId,
    sessionId,
    groupId,
    sinceId,
    timestamp: new Date().toISOString()
  });

  const authRes = await requireAuth(request);
  if (!authRes.ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }

  const limitParam = url.searchParams.get("limit");
  const limit = Math.max(1, Math.min(500, Number.isFinite(Number(limitParam)) ? Number(limitParam) : 200));

  if (!sessionId.trim() && !groupId.trim()) {
    try {
      promMetrics.requestsTotal.labels("interactions", "GET", "400", "error").inc();
      promMetrics.requestErrorsTotal.labels("interactions", "GET", "400", "error").inc();
      promMetrics.apiRetryErrorsTotal.labels("interactions", "GET", "validation_error", "400").inc();
    } catch {}
    return new Response(JSON.stringify({ error: "sessionId or groupId required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }

  const convexUrl = convexBaseUrl();
  try {
    if (getEnvString("MOCK_CONVEX") === '1') {
      let interactions: Array<Record<string, unknown>> = [];
      if (sessionId.trim()) {
        interactions = await mockConvex.listTailBySession({ sessionId, limit });
      } else {
        interactions = await mockConvex.listInteractionsByGroup({ groupId, limit });
      }

      // Handle incremental fetching if sinceId is provided
      if (sinceId && interactions.length > 0) {
        const sinceIndex = interactions.findIndex((interaction: any) =>
          String(interaction?.messageId || "") === sinceId
        );
        if (sinceIndex >= 0) {
          interactions = interactions.slice(sinceIndex + 1);
        }
      }

      // Generate ETag for caching
      const etagComponents = [sessionId || groupId, String(interactions.length), String(limit)];
      if (sinceId) etagComponents.push(sinceId);
      const etag = createHash('md5').update(etagComponents.join(':')).digest('hex');

      // If client cache matches, 304 Not Modified
      const inm = headersIn.get('if-none-match');
      if (inm && inm === etag) {
        const hdrs304 = { "X-Request-Id": requestId, "ETag": etag, "X-Cache": "HIT-304", "X-Mode": sinceId ? "since" : "full", ...corsHeaders } as Record<string, string>;
        devLog("info", "interactions: 304 Not Modified response", {
          sessionId,
          groupId,
          sinceId: sinceId || null,
          etag,
          requestId
        });
        return new Response(null, { status: 304, headers: hdrs304 });
      }

      // Get latest ID for cache management
      const latestId = interactions.length > 0 ?
        String(interactions[interactions.length - 1]?.messageId || "") : null;

      const headers = {
        "content-type": "application/json; charset=utf-8",
        "X-Request-Id": requestId,
        "ETag": etag,
        "X-Mode": sinceId ? "since" : "full",
        "X-Cache": "MISS",
        ...corsHeaders
      } as Record<string, string>;
      if (latestId) headers["X-Latest-Id"] = latestId;
      devLog("info", "interactions: 200 OK response", {
        sessionId,
        groupId,
        sinceId: sinceId || null,
        count: interactions.length,
        mode: sinceId ? 'since' : 'full',
        requestId,
        processingTimeMs: Date.now() - startTime
      });

      return new Response(JSON.stringify({
        interactions,
        latestId,
        count: interactions.length,
        hasMore: interactions.length >= limit
      }), {
        status: 200,
        headers,
      });
    }

    const client = makeConvex(convexUrl);
    let interactions: Array<Record<string, unknown>> = [];

    // Add timeout to prevent hanging queries (30 second timeout)
    const queryTimeout = 30000; // 30 seconds
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Convex query timeout')), queryTimeout);
    });

    const queryStart = Date.now();
    try {
      console.log(`[Convex] Starting query - sessionId: ${sessionId}, groupId: ${groupId}, limit: ${limit}, convexUrl: ${convexUrl}`);
      
      if (sessionId.trim()) {
        console.log(`[Convex] Calling listTailBySession with sessionId: ${sessionId}`);
        interactions = await Promise.race([
          client.query("functions/interactions:listTailBySession", { sessionId, limit }),
          timeoutPromise
        ]) as any;
      } else {
        console.log(`[Convex] Calling listByGroup with groupId: ${groupId}`);
        interactions = await Promise.race([
          client.query("functions/interactions:listByGroup", { groupId, limit }),
          timeoutPromise
        ]) as any;
      }
      
      const queryDuration = Date.now() - queryStart;
      console.log(`[Convex] Query completed successfully in ${queryDuration}ms, returned ${interactions?.length || 0} interactions`);
    } catch (queryError: any) {
      const queryDuration = Date.now() - queryStart;
      console.log(`[Convex] Query failed after ${queryDuration}ms:`, {
        error: queryError?.message || 'Unknown error',
        code: queryError?.code,
        cause: queryError?.cause?.code || queryError?.cause,
        stack: queryError?.stack?.split('\n')[0]
      });
      // If query times out or fails, log and continue with empty interactions
      // The fallback logic below will handle returning an empty response
      try {
        console.warn(`[interactions] Convex query failed for sessionId=${sessionId || 'none'} groupId=${groupId || 'none'}:`, queryError.message);
      } catch {}
      interactions = []; // Ensure we have an empty array for fallback logic
    }

    // Handle incremental fetching if sinceId is provided
    if (sinceId && interactions.length > 0) {
      const sinceIndex = interactions.findIndex((interaction: any) =>
        String(interaction?.messageId || "") === sinceId
      );
      if (sinceIndex >= 0) {
        interactions = interactions.slice(sinceIndex + 1);
      }
    }

    // Generate ETag for caching
    const etagComponents = [sessionId || groupId, String(interactions.length), String(limit)];
    if (sinceId) etagComponents.push(sinceId);
    const etag = createHash('md5').update(etagComponents.join(':')).digest('hex');

    // If client cache matches, 304 Not Modified
    const inm = headersIn.get('if-none-match');
    if (inm && inm === etag) {
      const hdrs304 = { "X-Request-Id": requestId, "ETag": etag, "X-Cache": "HIT-304", "X-Mode": sinceId ? "since" : "full", ...corsHeaders } as Record<string, string>;
      try { console.log(JSON.stringify({ level: 'info', where: 'interactions.get.304', sessionId, groupId, sinceId: sinceId || null, etag })); } catch {}
      return new Response(null, { status: 304, headers: hdrs304 });
    }

    // Get latest ID for cache management
    const latestId = interactions.length > 0 ?
      String(interactions[interactions.length - 1]?.messageId || "") : null;
    // Track successful GET request
    try {
      promMetrics.requestsTotal.labels("interactions", "GET", "200", "success").inc();
      promMetrics.requestDurationSeconds.labels("interactions", "GET", "200", "success").observe(Date.now() / 1000);
    } catch {}

    const headers = {
      "content-type": "application/json; charset=utf-8",
      "X-Request-Id": requestId,
      "ETag": etag,
      "X-Mode": sinceId ? "since" : "full",
      "X-Cache": "MISS",
      ...corsHeaders
    } as Record<string, string>;
    if (latestId) headers["X-Latest-Id"] = latestId;
    try { console.log(JSON.stringify({ level: 'info', where: 'interactions.get.200', sessionId, groupId, sinceId: sinceId || null, count: interactions.length, mode: sinceId ? 'since' : 'full' })); } catch {}

    return new Response(JSON.stringify({
      interactions,
      latestId,
      count: interactions.length,
      hasMore: interactions.length >= limit
    }), {
      status: 200,
      headers,
    });
  } catch (err: unknown) {
    try { console.error('[interactions] GET failed', err); } catch {}

    // Soft-fallback: return an empty interactions payload to avoid breaking the UI when backend is down
    try {
      const empty = [] as any[];
      const baseKey = sessionId || groupId || 'none';
      // Lightweight ETag for empty payload
      let etag = 'empty';
      try { const { createHash } = await import('crypto'); etag = createHash('md5').update(`${baseKey}:0:${limit}:${sinceId || ''}`).digest('hex'); } catch {}
      const headers = {
        "content-type": "application/json; charset=utf-8",
        "X-Request-Id": requestId,
        "ETag": etag,
        ...corsHeaders,
      } as Record<string, string>;
      return new Response(JSON.stringify({ interactions: empty, latestId: null, count: 0, hasMore: false }), { status: 200, headers });
    } catch {}

    // Track failed GET request
    try {
      promMetrics.requestsTotal.labels("interactions", "GET", "502", "error").inc();
      promMetrics.requestErrorsTotal.labels("interactions", "GET", "502", "error").inc();
      promMetrics.apiRetryErrorsTotal.labels("interactions", "GET", "server_error", "502").inc();
    } catch {}

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
  "Access-Control-Expose-Headers": "X-Request-Id, ETag, X-Latest-Id",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function convexBaseUrl() {
  return getEnvString("CONVEX_URL") || getEnvString("NEXT_PUBLIC_CONVEX_URL") || "http://127.0.0.1:3210";
}

function aiApiBaseUrl() {
  return (
    getEnvString("AI_API_BASE_URL") ||
    getEnvString("NEXT_PUBLIC_AI_API_BASE_URL") ||
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

    // Track auth failure
    try {
      promMetrics.requestsTotal.labels("interactions", "POST", "401", "error").inc();
      promMetrics.requestErrorsTotal.labels("interactions", "POST", "401", "error").inc();
      promMetrics.apiRetryErrorsTotal.labels("interactions", "POST", "auth_error", "401").inc();
    } catch {}

    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    try {
      promMetrics.requestsTotal.labels("interactions", "POST", "400", "error").inc();
      promMetrics.requestErrorsTotal.labels("interactions", "POST", "400", "error").inc();
      promMetrics.apiRetryErrorsTotal.labels("interactions", "POST", "json_error", "400").inc();
    } catch {}
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }

  const obj = (json ?? {}) as Record<string, unknown>;
  const required = ["sessionId", "messageId", "role", "contentHash", "ts"] as const;
  for (const k of required) {
    if (obj[k] === undefined || obj[k] === null) {
      try {
        promMetrics.requestsTotal.labels("interactions", "POST", "400", "error").inc();
        promMetrics.requestErrorsTotal.labels("interactions", "POST", "400", "error").inc();
        promMetrics.apiRetryErrorsTotal.labels("interactions", "POST", "validation_error", "400").inc();
      } catch {}
      return new Response(JSON.stringify({ error: `${k} required` }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
      });
    }
  }

  // Runtime validations
  const isNonEmptyString = (v: unknown) => typeof v === 'string' ? v.trim().length > 0 : typeof v === 'number' ? String(v).trim().length > 0 : false;
  if (!isNonEmptyString(obj.sessionId)) {
    try {
      promMetrics.requestsTotal.labels("interactions", "POST", "400", "error").inc();
      promMetrics.requestErrorsTotal.labels("interactions", "POST", "400", "error").inc();
      promMetrics.apiRetryErrorsTotal.labels("interactions", "POST", "validation_error", "400").inc();
    } catch {}
    return new Response(JSON.stringify({ error: "sessionId must be a non-empty string" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }
  // groupId is optional; if provided, must be a non-empty string
  if (obj.groupId !== undefined && obj.groupId !== null && !isNonEmptyString(obj.groupId)) {
    try {
      promMetrics.requestsTotal.labels("interactions", "POST", "400", "error").inc();
      promMetrics.requestErrorsTotal.labels("interactions", "POST", "400", "error").inc();
      promMetrics.apiRetryErrorsTotal.labels("interactions", "POST", "validation_error", "400").inc();
    } catch {}
    return new Response(JSON.stringify({ error: "groupId, if provided, must be a non-empty string" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }
  if (!isNonEmptyString(obj.messageId)) {
    try {
      promMetrics.requestsTotal.labels("interactions", "POST", "400", "error").inc();
      promMetrics.requestErrorsTotal.labels("interactions", "POST", "400", "error").inc();
      promMetrics.apiRetryErrorsTotal.labels("interactions", "POST", "validation_error", "400").inc();
    } catch {}
    return new Response(JSON.stringify({ error: "messageId must be a non-empty string" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }
  const tsNum = Number(obj.ts);
  if (!Number.isFinite(tsNum) || tsNum <= 0) {
    try {
      promMetrics.requestsTotal.labels("interactions", "POST", "400", "error").inc();
      promMetrics.requestErrorsTotal.labels("interactions", "POST", "400", "error").inc();
      promMetrics.apiRetryErrorsTotal.labels("interactions", "POST", "validation_error", "400").inc();
    } catch {}
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
      try {
        promMetrics.requestsTotal.labels("interactions", "POST", "400", "error").inc();
        promMetrics.requestErrorsTotal.labels("interactions", "POST", "400", "error").inc();
        promMetrics.apiRetryErrorsTotal.labels("interactions", "POST", "validation_error", "400").inc();
      } catch {}
      return new Response(JSON.stringify({ error: "audioUrl must be a valid http(s) URL" }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
      });
    }
  }
  if (obj.text !== undefined && obj.text !== null && typeof obj.text !== 'string') {
    try {
      promMetrics.requestsTotal.labels("interactions", "POST", "400", "error").inc();
      promMetrics.requestErrorsTotal.labels("interactions", "POST", "400", "error").inc();
      promMetrics.apiRetryErrorsTotal.labels("interactions", "POST", "validation_error", "400").inc();
    } catch {}
    return new Response(JSON.stringify({ error: "text, if provided, must be a string" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }
  if (obj.userId !== undefined && obj.userId !== null && !isNonEmptyString(obj.userId)) {
    try {
      promMetrics.requestsTotal.labels("interactions", "POST", "400", "error").inc();
      promMetrics.requestErrorsTotal.labels("interactions", "POST", "400", "error").inc();
      promMetrics.apiRetryErrorsTotal.labels("interactions", "POST", "validation_error", "400").inc();
    } catch {}
    return new Response(JSON.stringify({ error: "userId, if provided, must be a non-empty string" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }

  const roleStr = String(obj.role);
  const isRole = (r: string): r is InteractionRole =>
    r === 'user' || r === 'assistant' || r === 'system';
  if (!isRole(roleStr)) {
    try {
      promMetrics.requestsTotal.labels("interactions", "POST", "400", "error").inc();
      promMetrics.requestErrorsTotal.labels("interactions", "POST", "400", "error").inc();
      promMetrics.apiRetryErrorsTotal.labels("interactions", "POST", "validation_error", "400").inc();
    } catch {}
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
    text: obj.text !== undefined && obj.text !== null ? String(obj.text) : undefined,
    ts: Number(obj.ts),
    userId: obj.userId !== undefined && obj.userId !== null ? String(obj.userId) : undefined,
  };

  // Enhanced sessionId observability logging
  try {
    console.log(JSON.stringify({
      level: 'info',
      where: 'interactions.post.session_debug',
      requestId,
      receivedSessionId: body.sessionId,
      sessionIdFormat: body.sessionId.startsWith('sess_') ? 'convex_generated' : (body.sessionId.includes('-') ? 'uuid_format' : 'other'),
      userId: body.userId,
      role: body.role,
      messageId: body.messageId
    }));
  } catch {}

  const convexUrl = convexBaseUrl();

  // Convex environment and URL sanity logging
  try {
    const envSnapshot = {
      CONVEX_URL: getEnvString("CONVEX_URL") || null,
      NEXT_PUBLIC_CONVEX_URL: getEnvString("NEXT_PUBLIC_CONVEX_URL") || null,
      MOCK_CONVEX: getEnvString("MOCK_CONVEX") || null,
      TRIAGE_ON_USER_INGEST: getEnvString("TRIAGE_ON_USER_INGEST") || null,
    };
    console.log(JSON.stringify({ level: 'info', where: 'interactions.post.convex_env', requestId, snapshot: envSnapshot, convexUrl }));
    if (typeof convexUrl === 'string' && /dashboard\.convex\.dev/.test(convexUrl)) {
      console.warn(JSON.stringify({ level: 'warn', where: 'interactions.post.convex_url_misconfigured', requestId, convexUrl, hint: 'Use https://<deployment>.convex.cloud, not dashboard URL' }));
    }
  } catch {}

  try {
    const authedUserId = authRes.userId && authRes.userId !== 'anonymous' ? authRes.userId : undefined;
    const effectiveUserId = String(authedUserId || body.userId || 'unknown');
    
    // Check if session exists and belongs to this user (for observability)
    let sessionExists = false;
    let sessionBelongsToUser = false;
    try {
      if (getEnvString("MOCK_CONVEX") !== '1') {
        console.log(`[Convex] Starting session validation query for sessionId: ${body.sessionId}`);
        const sessionQueryStart = Date.now();
        
        const client = makeConvex(convexUrl);
        const sessionDoc = await client.query("functions/sessions:getBySessionId", { sessionId: body.sessionId });
        
        const sessionQueryDuration = Date.now() - sessionQueryStart;
        console.log(`[Convex] Session validation query completed in ${sessionQueryDuration}ms`);
        
        const session: any = (sessionDoc as { value?: any })?.value || null;
        sessionExists = !!session;
        sessionBelongsToUser = session && session.userId === effectiveUserId;
        
        console.log(`[Convex] Session validation result: exists=${sessionExists}, belongsToUser=${sessionBelongsToUser}, userId=${effectiveUserId}`);
        
        // Log session validation results
        console.log(JSON.stringify({
          level: 'info',
          where: 'interactions.post.session_validation',
          requestId,
          sessionId: body.sessionId,
          sessionExists,
          sessionBelongsToUser,
          effectiveUserId,
          sessionUserId: session?.userId || null
        }));
        
        // Warn if session doesn't exist or doesn't belong to user
        if (!sessionExists) {
          console.warn(JSON.stringify({
            level: 'warn',
            where: 'interactions.post.session_not_found',
            requestId,
            sessionId: body.sessionId,
            effectiveUserId,
            message: 'Interaction posted to non-existent session - this may cause new session creation'
          }));
        } else if (!sessionBelongsToUser) {
          console.warn(JSON.stringify({
            level: 'warn',
            where: 'interactions.post.session_user_mismatch',
            requestId,
            sessionId: body.sessionId,
            effectiveUserId,
            sessionUserId: session?.userId,
            message: 'Session belongs to different user'
          }));
        }
      }
    } catch (sessionCheckError) {
      // Don't fail the request if session check fails
      console.warn(JSON.stringify({
        level: 'warn',
        where: 'interactions.post.session_check_failed',
        requestId,
        sessionId: body.sessionId,
        error: String(sessionCheckError)
      }));
    }
    if (getEnvString("MOCK_CONVEX") === '1') {
      // Skip empty or meaningless text content
      const text = body.text?.trim();
      if (!text || text.length === 0) {
        console.log("[interactions] Skipping empty interaction - no meaningful text content (mock)");
        return new Response(JSON.stringify({ ok: true, id: null, skipped: "empty_text" }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
        });
      }

      const res = await mockConvex.appendInteraction({
        sessionId: body.sessionId,
        groupId: body.groupId,
        messageId: body.messageId,
        role: body.role,
        contentHash: body.contentHash,
        text: text,
        audioUrl: body.audioUrl !== undefined && body.audioUrl !== null ? String(body.audioUrl) : undefined,
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

    // New: per-user-message triage (after user message saved), non-blocking
    try {
      const triageOnUser = String(getEnvString("TRIAGE_ON_USER_INGEST") || '1').toLowerCase();
      if (triageOnUser === '1' || triageOnUser === 'true') {
        if (body.role === 'user') {
          // Use the just-posted user messageId directly to avoid list timeouts
          const messageIds = [String(body.messageId)].filter(Boolean);
          if (messageIds.length > 0) {
            const ctrl = new AbortController();
            const to = setTimeout(() => ctrl.abort(), Math.max(300, Math.min(2000, Number(getEnvString("TRIAGE_TIMEOUT_MS") || 1200))));
            const authz = (request.headers.get('authorization') || request.headers.get('Authorization') || '') as string;
            const headers: Record<string, string> = { 'content-type': 'application/json', 'x-request-id': requestId };
            if (authz) headers['authorization'] = authz;
            fetch(`${getEnvString("NEXT_PUBLIC_APP_URL") || 'http://localhost:3000'}/api/v1/triage?sessionId=${encodeURIComponent(body.sessionId)}`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ messageIds }),
              cache: 'no-store',
              signal: ctrl.signal,
            }).catch(() => {}).finally(() => { try { clearTimeout(to); } catch {} });
            try { console.log(JSON.stringify({ level: 'info', where: 'interactions.triage.user_ingest.mock', sessionId: body.sessionId, messageIds })); } catch {}
          }
        }
      }
    } catch {}

      // Ingest-driven cadence: on assistant message, evaluate cadence just like non-mock
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

          // Production semantics: count assistant turns since last completed summary
          const thrEnv = Number(getEnvString("NEXT_PUBLIC_SUMMARY_REFRESH_TURNS") || 4);
          const thresholdTurns = Math.max(1, Math.min(20, Number.isFinite(thrEnv) ? thrEnv : 4));

          // Determine cutoff from latest summary
          const last = getLatestSummary(body.sessionId);
          const cutoffTs = typeof last?.updatedAt === 'number' ? last!.updatedAt : 0;

          // Pull recent interactions from mock store
          const docs: any[] = await mockConvex.listInteractionsBySession({ sessionId: body.sessionId, limit: 300 }) as any[];
          const arr = Array.isArray(docs) ? docs : [];
          const after = cutoffTs > 0 ? arr.filter(d => Number(d?.ts || 0) > cutoffTs) : arr;

          const assistantSince = after.filter(d => String(d?.role || '') === 'assistant').length;

          if (assistantSince >= thresholdTurns) {
            // Build recent message window for summarizer (after cutoff, or fallback to last few)
            const recentBase = after.length > 0 ? after : arr.slice(-8);
            const recent = recentBase
              .map((d: any) => ({ role: String(d?.role || ''), content: String(d?.text || '') }))
              .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && m.content && m.content.trim().length > 0);

            const tokenBudget = 600;
            const prevText = String(last?.text || '');
            const text = generateSummaryText(prevText, recent, tokenBudget);
            const lastMessageTs = arr.length > 0
              ? Math.max(...arr.map((d: any) => Number(d?.ts || d?.createdAt || 0)).filter((n: number) => Number.isFinite(n)))
              : Date.now();

            const row = upsertSummary({ sessionId: body.sessionId, text, lastMessageTs, meta: { tokenBudget } });
            // Log generation for observability
            try {
              await mockConvex.logEvent({
                userId: effectiveUserId,
                sessionId: body.sessionId,
                groupId: body.groupId,
                requestId,
                trackedSkillIdHash,
                kind: 'summary_cadence_generated',
                payload: { version: row.version, len: text.length },
              });
            } catch {}
          }
        }
      } catch {}
      return new Response(JSON.stringify({ ok: true, id: res?.id ?? null }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
      });
    }

    // Skip empty or meaningless text content
    const text = body.text?.trim();
    if (!text || text.length === 0) {
      console.log("[interactions] Skipping empty interaction - no meaningful text content");
      return new Response(JSON.stringify({ ok: true, id: null, skipped: "empty_text" }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
      });
    }

    console.log(`[Convex] Starting appendInteraction mutation - sessionId: ${body.sessionId}, messageId: ${body.messageId}, role: ${body.role}, convexUrl: ${convexUrl}`);
    const mutationStart = Date.now();
    const client = makeConvex(convexUrl);
    let id: unknown = null;
    try {
      id = await client.mutation("functions/interactions:appendInteraction", {
        sessionId: body.sessionId,
        groupId: body.groupId,
        messageId: body.messageId,
        role: body.role,
        contentHash: body.contentHash,
        text: text,
        audioUrl: body.audioUrl,
        ts: body.ts,
      });
      const mutationDuration = Date.now() - mutationStart;
      console.log(`[Convex] appendInteraction completed in ${mutationDuration}ms, returned id: ${id}`);
    } catch (appendErr: any) {
      const mutationDuration = Date.now() - mutationStart;
      const errMsg = String(appendErr?.message || appendErr);
      const hint = /<!DOCTYPE|<html|dashboard\.convex\.dev/.test(errMsg) || /dashboard\.convex\.dev/.test(convexUrl)
        ? 'convex_dashboard_url_in_use'
        : undefined;
      console.error(JSON.stringify({
        level: 'error',
        where: 'interactions.post.appendInteraction.error',
        requestId,
        sessionId: body.sessionId,
        messageId: body.messageId,
        convexUrl,
        durationMs: mutationDuration,
        error: errMsg,
        code: appendErr?.code || null,
        cause: appendErr?.cause?.code || appendErr?.cause || null,
        hint,
      }));
      throw appendErr;
    }
    
    console.log(`[Convex] Starting logEvent mutation for interaction_appended`);
    const eventStart = Date.now();
    try {
      await client.mutation("functions/events:logEvent", {
        userId: effectiveUserId,
        sessionId: body.sessionId,
        groupId: body.groupId,
        requestId,
        trackedSkillIdHash,
        kind: 'interaction_appended',
        payload: { messageId: body.messageId, role: body.role },
      });
      const eventDuration = Date.now() - eventStart;
      console.log(`[Convex] logEvent completed in ${eventDuration}ms`);
    } catch (logErr: any) {
      const eventDuration = Date.now() - eventStart;
      console.error(JSON.stringify({
        level: 'error',
        where: 'interactions.post.logEvent.error',
        requestId,
        sessionId: body.sessionId,
        messageId: body.messageId,
        convexUrl,
        durationMs: eventDuration,
        error: String(logErr?.message || logErr),
        code: logErr?.code || null,
        cause: logErr?.cause?.code || logErr?.cause || null,
      }));
      // Do not throw; best-effort logging should not fail the request
    }

    // New: per-user-message triage (after user message saved), non-blocking
    try {
      const triageOnUser = String(getEnvString("TRIAGE_ON_USER_INGEST") || '1').toLowerCase();
      if (triageOnUser === '1' || triageOnUser === 'true') {
        if (body.role === 'user') {
          // Use the just-posted user messageId directly to avoid Convex list timeouts
          const messageIds = [String(body.messageId)].filter(Boolean);
          if (messageIds.length > 0) {
            const ctrl = new AbortController();
            const to = setTimeout(() => ctrl.abort(), Math.max(300, Math.min(2000, Number(getEnvString("TRIAGE_TIMEOUT_MS") || 1200))));
            const authz = (request.headers.get('authorization') || request.headers.get('Authorization') || '') as string;
            const headers: Record<string, string> = { 'content-type': 'application/json', 'x-request-id': requestId };
            if (authz) headers['authorization'] = authz;
            try { console.log(JSON.stringify({ level: 'info', where: 'interactions.triage.user_ingest.headers', sessionId: body.sessionId, hasAuth: Boolean(authz) })); } catch {}
            fetch(`${getEnvString("NEXT_PUBLIC_APP_URL") || 'http://localhost:3000'}/api/v1/triage?sessionId=${encodeURIComponent(body.sessionId)}`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ messageIds }),
              cache: 'no-store',
              signal: ctrl.signal,
            }).then(async (res) => {
              try {
                const result = await res.json();
                console.log(JSON.stringify({ level: 'info', where: 'interactions.triage.user_ingest.success', sessionId: body.sessionId, messageIds, status: res.status, result }));
              } catch (e) {
                console.log(JSON.stringify({ level: 'warn', where: 'interactions.triage.user_ingest.parse_error', sessionId: body.sessionId, messageIds, status: res.status, error: (e as Error).message }));
              }
            }).catch((e) => {
              console.log(JSON.stringify({ level: 'error', where: 'interactions.triage.user_ingest.fetch_error', sessionId: body.sessionId, messageIds, error: (e as Error).message }));
            }).finally(() => { try { clearTimeout(to); } catch {} });
            try { console.log(JSON.stringify({ level: 'info', where: 'interactions.triage.user_ingest', sessionId: body.sessionId, messageIds })); } catch {}
          }
        } else {
          try { console.log(JSON.stringify({ level: 'info', where: 'interactions.triage.user_ingest.skip', sessionId: body.sessionId, reason: 'role_not_user' })); } catch {}
        }
      } else {
        try { console.log(JSON.stringify({ level: 'info', where: 'interactions.triage.user_ingest.disabled' })); } catch {}
      }
    } catch {}

    // Ingest-driven cadence: when assistant message finalized, ask Convex to update cadence state
    if (body.role === 'assistant') {
      try {
        const cadence = await client.mutation("functions/summary_state:onAssistantMessage", { sessionId: body.sessionId }) as any;

        // Check if the mutation failed due to concurrent modification
        if (cadence === null || cadence === undefined) {
          try {
            console.warn(`[interactions] Cadence mutation failed (possibly concurrent modification) for session ${body.sessionId}`);
            promMetrics.apiRetryErrorsTotal.labels("interactions", "POST", "concurrent_modification", "0").inc();
          } catch {}
          // Don't proceed with summary generation if cadence update failed
          return new Response(JSON.stringify({ ok: true, id, warning: "concurrent_modification" }), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
          });
        }

        // Log successful cadence update
        try {
          console.log(`[interactions] Cadence updated successfully for session ${body.sessionId}:`, {
            dueNow: cadence?.dueNow,
            locked: cadence?.locked,
            turnsSince: cadence?.turnsSince,
            assistantMsgSince: cadence?.assistantMsgSince
          });
        } catch {}
        await client.mutation("functions/events:logEvent", {
          userId: effectiveUserId,
          sessionId: body.sessionId,
          groupId: body.groupId,
          requestId,
          trackedSkillIdHash,
          kind: 'summary_cadence_onAssistantMessage',
          payload: { messageId: body.messageId, cadence },
        });

        // Check for concurrent modification errors in the response
        if (cadence === null || typeof cadence !== 'object') {
          try {
            console.warn(`[interactions] Cadence mutation returned invalid result for session ${body.sessionId}:`, cadence);
            promMetrics.apiRetryErrorsTotal.labels("interactions", "POST", "invalid_cadence_response", "0").inc();
          } catch {}
        }

        // Orchestrate generation if due and lock acquired
        if (cadence?.dueNow && cadence?.locked) {
          const tokenBudget = 600;
          // Fetch latest summary for prev text and cutoff
          const latest: any = await client.query("functions/summaries:getLatest", { sessionId: body.sessionId });
          const prevSummary = String(latest?.text || "");
          const cutoffTs = Number(latest?.lastMessageTs || 0);
          // Collect recent interactions (bounded) and filter after cutoff
          let interactions: Array<any> = await client.query("functions/interactions:listTailBySession", { sessionId: body.sessionId, limit: 200 }) as any;
          interactions = Array.isArray(interactions) ? interactions : [];
          const recent = interactions
            .filter((d: any) => (d?.ts ?? 0) > cutoffTs)
            .map((d: any) => ({ role: d?.role === 'assistant' ? 'assistant' : 'user', content: String(d?.text || "") }))
            .filter((m: any) => m.content && m.content.trim().length > 0);
          const recentMessages = recent.length > 0 ? recent : interactions.slice(-4).map((d: any) => ({ role: d?.role === 'assistant' ? 'assistant' : 'user', content: String(d?.text || "") })).filter((m: any) => m.content && m.content.trim().length > 0);

          // Stage 2+: best-effort triage before summary generation (non-blocking)
          try {
            const triageEnabled = String(getEnvString("AI_TRIAGE_ENABLED") || '').toLowerCase();
            const triageOnSummary = String(getEnvString("TRIAGE_ON_SUMMARY") || '0').toLowerCase();
            if ((triageEnabled === '1' || triageEnabled === 'true') && (triageOnSummary === '1' || triageOnSummary === 'true')) {
              const ctrl = new AbortController();
              const to = setTimeout(() => ctrl.abort(), Math.max(300, Math.min(2000, Number(getEnvString("TRIAGE_TIMEOUT_MS") || 1200))));
              const authz = (request.headers.get('authorization') || request.headers.get('Authorization') || '') as string;
              const triageHeaders: Record<string, string> = { accept: 'application/json', 'x-request-id': requestId };
              if (authz) triageHeaders['authorization'] = authz;
              fetch(`/api/v1/triage?sessionId=${encodeURIComponent(body.sessionId)}&limit=20`, { method: 'POST', headers: triageHeaders, cache: 'no-store', signal: ctrl.signal })
                .catch(() => {})
                .finally(() => { try { clearTimeout(to); } catch {} });
              try { console.log(JSON.stringify({ level: 'info', where: 'interactions.triage.pre', sessionId: body.sessionId })); } catch {}
            }
          } catch {}

          // Best-effort assessments step: after triage, before summary
          try {
            const assessEnabled = String(getEnvString("AI_ASSESS_ENABLED") || '').toLowerCase();
            if (assessEnabled === '1' || assessEnabled === 'true') {
              const maxGroups = Math.max(1, Math.min(20, Number(getEnvString("ASSESS_MAX_GROUPS") || 5)));
              const maxSkills = Math.max(1, Math.min(50, Number(getEnvString("ASSESS_MAX_SKILLS") || 8)));
              const assessTimeoutMs = Math.max(500, Math.min(8000, Number(getEnvString("ASSESS_TIMEOUT_MS") || 5000)));
              const salt = (getEnvString("SKILL_HASH_SALT") || 'test_salt').trim();

              // Resolve cutoff (from latest summary) and recent interactions
              const latest: any = await client.query("functions/summaries:getLatest", { sessionId: body.sessionId }).catch(() => null);
              const cutoffTs = Number(latest?.lastMessageTs || 0);
              let interactions: Array<any> = await client.query("functions/interactions:listTailBySession", { sessionId: body.sessionId, limit: 200 }).catch(() => []) as any[];
              interactions = Array.isArray(interactions) ? interactions : [];
              let recent = interactions.filter((d: any) => (Number(d?.ts || 0) > cutoffTs));
              if (recent.length === 0) {
                // Fallback to last few if cutoff not available
                recent = interactions.slice(-20);
              }
              // Build groupIds (non-empty) in recent slice
              const groupIds = Array.from(new Set(recent.map((d: any) => String(d?.groupId || '').trim()).filter((g: string) => g.length > 0))).slice(0, maxGroups);

              // Fetch tracked skills for the user
              const rows: any[] = await client.query("functions/skills:getTrackedSkillsForUser", { userId: effectiveUserId }).catch(() => []) as any[];
              const trackedList = Array.isArray(rows) ? rows : [];
              const pickSkillId = (r: any) => (r?.skillId || r?.skill?.id || r?.id || '').toString();
              const pickLevel = (r: any) => {
                const lv = Number(r?.currentLevel);
                return Number.isFinite(lv) && lv >= 0 && lv <= 10 ? lv : 5;
              };
              const skills = trackedList.map((r) => ({ id: pickSkillId(r), level: pickLevel(r) }))
                .filter((s) => s.id)
                .slice(0, maxSkills);

              if (groupIds.length > 0 && skills.length > 0) {
                const authz = (request.headers.get('authorization') || request.headers.get('Authorization') || '') as string;
                const headers: Record<string, string> = { 'content-type': 'application/json', 'x-request-id': requestId };
                if (authz) headers['authorization'] = authz;

                // Log attempt
                try {
                  await client.mutation("functions/events:logEvent", {
                    userId: effectiveUserId,
                    sessionId: body.sessionId,
                    groupId: undefined,
                    requestId,
                    trackedSkillIdHash,
                    kind: 'assess_cadence_started',
                    payload: { groups: groupIds.length, skills: skills.length }
                  });
                } catch {}

                // Dispatch one finalize per group (batch skills per group)
                let completed = 0;
                for (const gid of groupIds) {
                  // Default skeleton results from tracked skills (fallback)
                  let skillAssessments = skills.map((s) => ({
                    skillId: s.id,
                    skillHash: sha256Hex(`${salt}:${s.id}`),
                    level: s.level,
                    confidence: undefined as number | undefined,
                    levelFeedback: {
                      currentLevel: s.level,
                      nextLevelCriteria: [] as string[],
                      strengths: [] as string[],
                      improvements: [] as string[],
                      focus: [] as string[],
                      examples: [] as string[],
                    },
                    assessmentMetadata: {} as Record<string, unknown>,
                    sourceContext: { assessmentType: 'single_qa_pair' as string },
                    // Legacy fields (kept empty for compatibility)
                    metCriteria: [] as string[],
                    unmetCriteria: [] as string[],
                    feedback: [] as string[],
                  }));

                  // PRE-SUMMARY FINALIZE is hard-disabled
                  const allowPreSummary = false;
                  if (!allowPreSummary) {
                    try { await client.mutation("functions/events:logEvent", { userId: effectiveUserId, sessionId: body.sessionId, groupId: gid, requestId, trackedSkillIdHash, kind: 'interactions.pre.assess.skip', payload: { reason: 'hard_disabled' } }); } catch {}
                  } else {
                    // Legacy path removed (no-op)
                  }
                }
                // end PRE_SUMMARY_FINALIZE guard

                // Log completion
                try {
                  await client.mutation("functions/events:logEvent", {
                    userId: effectiveUserId,
                    sessionId: body.sessionId,
                    groupId: undefined,
                    requestId,
                    trackedSkillIdHash,
                    kind: 'assess_cadence_completed',
                    payload: { groups: groupIds.length, skills: skills.length, completed }
                  });
                } catch {}

              }
            }
          } catch (e) {
            try { console.warn(JSON.stringify({ level: 'warn', where: 'interactions.assess.pre.error', sessionId: body.sessionId, error: String(e) })); } catch {}
            // Never block summary on assess errors
          }

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
          // If AI returned empty, fallback to previous summary text (don't advance cutoff)
          let effectiveLastMessageTs: number = Date.now();
          if (!text || text.trim().length === 0) {
            const fallback = (prevSummary || '').trim();
            if (!fallback) {
              // No previous summary to fallback to → release lock and skip
              try { await client.mutation("functions/summary_state:releaseLock", { sessionId: body.sessionId }); } catch {}
              try {
                await client.mutation("functions/events:logEvent", {
                  userId: effectiveUserId,
                  sessionId: body.sessionId,
                  groupId: body.groupId,
                  requestId,
                  trackedSkillIdHash,
                  kind: 'summary_cadence_generate_empty',
                  payload: { messageId: body.messageId },
                });
              } catch {}
              return new Response(JSON.stringify({ ok: true, skipped: 'empty_text' }), {
                status: 200,
                headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
              });
            }
            text = fallback;
            effectiveLastMessageTs = Number(latest?.lastMessageTs || Date.now());
            try {
              await client.mutation("functions/events:logEvent", {
                userId: effectiveUserId,
                sessionId: body.sessionId,
                groupId: body.groupId,
                requestId,
                trackedSkillIdHash,
                kind: 'summary_cadence_generate_fallback_prev',
                payload: { messageId: body.messageId },
              });
            } catch {}
          }

          // Persist to Convex
          let inserted: any = null;
          try {
            inserted = await client.mutation("functions/summaries:insert", { sessionId: body.sessionId, text, lastMessageTs: effectiveLastMessageTs, meta: { tokenBudget } });
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
            await client.mutation("functions/events:logEvent", {
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
      } catch (cadenceError) {
        // Handle errors in the cadence update process
        try {
          console.error(`[interactions] Cadence update failed for session ${body.sessionId}:`, cadenceError);
          promMetrics.apiRetryErrorsTotal.labels("interactions", "POST", "cadence_update_error", "0").inc();

          // Check if this is a concurrent modification error
          const errorMessage = (cadenceError as Error)?.message || String(cadenceError);
          const isConcurrentError = errorMessage.includes("changed while") ||
                                   errorMessage.includes("Concurrent modification") ||
                                   errorMessage.includes("Documents changed");

          if (isConcurrentError) {
            promMetrics.apiRetryErrorsTotal.labels("interactions", "POST", "concurrent_modification", "0").inc();
          }
        } catch {}

        // Still return success for the interaction itself, even if cadence update failed
        try { console.log(`[interactions] Interaction saved successfully despite cadence error for session ${body.sessionId}`); } catch {}
      }
    }

    // Track successful interaction
    try {
      promMetrics.requestsTotal.labels("interactions", "POST", "200", "success").inc();
      promMetrics.requestDurationSeconds.labels("interactions", "POST", "200", "success").observe(Date.now() / 1000);
    } catch {}

    return new Response(JSON.stringify({ ok: true, id }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  } catch (error: any) {
    // Detailed error logging for Convex issues
    const errObj = {
      error: error?.message || 'Unknown error',
      code: error?.code,
      cause: error?.cause?.code || error?.cause,
      stack: error?.stack?.split('\n')[0],
      sessionId: body?.sessionId,
      messageId: body?.messageId,
      role: body?.role,
      convexUrl: convexBaseUrl(),
      env: {
        CONVEX_URL: getEnvString("CONVEX_URL") || null,
        NEXT_PUBLIC_CONVEX_URL: getEnvString("NEXT_PUBLIC_CONVEX_URL") || null,
        MOCK_CONVEX: getEnvString("MOCK_CONVEX") || null,
      },
      hint: undefined as string | undefined,
    };
    if (/<!DOCTYPE|<html|dashboard\.convex\.dev/.test(String(error?.message || '')) || /dashboard\.convex\.dev/.test(convexBaseUrl())) {
      errObj.hint = 'convex_dashboard_url_in_use';
    }
    console.error(`[Convex] POST /api/v1/interactions failed:`, errObj);
    
    // Track failed interaction
    try {
      const errorType = error?.message?.includes('network') ? 'network_error' : 'server_error';
      promMetrics.requestsTotal.labels("interactions", "POST", "502", "error").inc();
      promMetrics.requestDurationSeconds.labels("interactions", "POST", "502", "error").observe(Date.now() / 1000);
      promMetrics.requestErrorsTotal.labels("interactions", "POST", "502", "error").inc();
      promMetrics.apiRetryErrorsTotal.labels("interactions", "POST", errorType, "502").inc();
    } catch {}

    return new Response(JSON.stringify({ error: "Convex mutation failed" }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }
}
