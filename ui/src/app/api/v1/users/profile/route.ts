/* eslint-disable no-console */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { makeConvex } from "../../../lib/convex";
import * as mockConvex from "../../../lib/mockConvex";
import { promMetrics } from "../../../lib/metrics";
import { clientKeyFromHeaders, rateLimit } from "../../../lib/ratelimit";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, Authorization",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function convexBaseUrl() {
  return process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
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
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId") || undefined;
  const started = Date.now();
  const mode = process.env.MOCK_CONVEX === '1' ? 'mock' : 'real';
  const routePath = '/api/v1/users/profile';
  const method = 'GET';
  const endTimer = promMetrics.requestDurationSeconds.startTimer();

  function respond(status: number, body: unknown, extraHeaders?: Record<string, string>) {
    const labels = { route: routePath, method, status: String(status), mode } as const;
    promMetrics.requestsTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    if (status >= 500) promMetrics.requestErrorsTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    endTimer(labels);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders, ...(extraHeaders || {}) },
    });
  }

  // Rate limit per client (best-effort; in-memory only)
  const rlKey = clientKeyFromHeaders(headersIn);
  const rl = rateLimit(`users-profile:${method}:${rlKey}`);
  if (!rl.ok) {
    const labels = { route: routePath, method, status: '429', mode } as const;
    promMetrics.rateLimitedTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 429, reason: 'rate_limited', retryAfterSec: rl.retryAfterSec }));
    return respond(429, { error: "Rate limit exceeded" }, { "Retry-After": String(rl.retryAfterSec), "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
  }
  const rateHeaders = { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) };

  if (!userId) {
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 400, msg: 'Missing userId', mode, latencyMs: Date.now() - started }));
    return respond(400, { error: "userId required" }, rateHeaders);
  }

  try {
    if (process.env.MOCK_CONVEX === '1') {
      const profile = await mockConvex.getUserProfile({ userId });
      console.log(JSON.stringify({ level: 'info', route: routePath, requestId, userId, status: 200, found: !!profile, mode, latencyMs: Date.now() - started }));
      return respond(200, { profile: profile ?? null }, rateHeaders);
    }

    const client = makeConvex(convexBaseUrl());
    const profile = await client.query("functions/users:getProfile", { userId }) as any;
    console.log(JSON.stringify({ level: 'info', route: routePath, requestId, userId, status: 200, found: !!profile, mode, latencyMs: Date.now() - started }));
    return respond(200, { profile: profile ?? null }, rateHeaders);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? 'Convex query failed');
    console.log(JSON.stringify({ level: 'error', route: routePath, requestId, userId, status: 502, error: msg, mode, latencyMs: Date.now() - started }));
    return respond(502, { error: "Convex query failed" }, rateHeaders);
  }
}

export async function PUT(request: Request) {
  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();
  const started = Date.now();
  const mode = process.env.MOCK_CONVEX === '1' ? 'mock' : 'real';
  const routePath = '/api/v1/users/profile';
  const method = 'PUT';
  const endTimer = promMetrics.requestDurationSeconds.startTimer();

  function respond(status: number, body: unknown, extraHeaders?: Record<string, string>) {
    const labels = { route: routePath, method, status: String(status), mode } as const;
    promMetrics.requestsTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    if (status >= 500) promMetrics.requestErrorsTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    endTimer(labels);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders, ...(extraHeaders || {}) },
    });
  }

  // Rate limit per client (best-effort; in-memory only)
  const rlKey = clientKeyFromHeaders(headersIn);
  const rl = rateLimit(`users-profile:${method}:${rlKey}`);
  if (!rl.ok) {
    const labels = { route: routePath, method, status: '429', mode } as const;
    promMetrics.rateLimitedTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 429, reason: 'rate_limited', retryAfterSec: rl.retryAfterSec }));
    return respond(429, { error: "Rate limit exceeded" }, { "Retry-After": String(rl.retryAfterSec), "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
  }
  const rateHeaders = { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) };

  let body: any = {};
  try { body = await request.json(); } catch {}
  const { userId, displayName, email, avatarUrl, bio } = body || {};
  if (!userId) {
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 400, msg: 'Missing userId', mode, latencyMs: Date.now() - started }));
    return respond(400, { error: "userId required" }, rateHeaders);
  }

  try {
    if (process.env.MOCK_CONVEX === '1') {
      const result = await mockConvex.upsertUserProfile({ userId, displayName, email, avatarUrl, bio });
      console.log(JSON.stringify({ level: 'info', route: routePath, requestId, userId, status: 200, created: !!result?.created, mode, latencyMs: Date.now() - started }));
      return respond(200, { ok: true, created: !!result?.created }, rateHeaders);
    }

    const client = makeConvex(convexBaseUrl());
    const result = await client.mutation("functions/users:upsertProfile", { userId, displayName, email, avatarUrl, bio }) as any;
    console.log(JSON.stringify({ level: 'info', route: routePath, requestId, userId, status: 200, created: !!result?.created, mode, latencyMs: Date.now() - started }));
    return respond(200, { ok: true, created: !!result?.created }, rateHeaders);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? 'Convex mutation failed');
    console.log(JSON.stringify({ level: 'error', route: routePath, requestId, userId, status: 502, error: msg, mode, latencyMs: Date.now() - started }));
    return respond(502, { error: "Convex mutation failed" }, rateHeaders);
  }
}
