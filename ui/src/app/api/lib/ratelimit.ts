/* Simple in-memory token bucket rate limiter for Next.js API routes.
 * Not production-grade (doesn't work across instances), but fine for local/dev.
 */

export type RateLimitOk = { ok: true; limit: number; remaining: number; resetSec: number };
export type RateLimitFail = { ok: false; retryAfterSec: number; limit: number; remaining: number; resetSec: number };
export type RateLimitResult = RateLimitOk | RateLimitFail;

const buckets = new Map<string, { tokens: number; lastRefill: number; capacity: number; refillPerSec: number }>();

function parseIntEnv(name: string, def: number): number {
  const v = Number(process.env[name] || "");
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : def;
}

let _config = {
  maxRps: parseIntEnv("RATE_LIMIT_MAX_RPS", 10),
  burst: parseIntEnv("RATE_LIMIT_BURST", 20),
};

export function rateLimit(key: string): RateLimitResult {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: _config.burst, lastRefill: now, capacity: _config.burst, refillPerSec: _config.maxRps };
    buckets.set(key, b);
  }
  // Refill tokens based on elapsed time
  const elapsedSec = Math.max(0, (now - b.lastRefill) / 1000);
  const refill = elapsedSec * b.refillPerSec;
  if (refill > 0) {
    b.tokens = Math.min(b.capacity, b.tokens + refill);
    b.lastRefill = now;
  }
  if (b.tokens >= 1) {
    b.tokens -= 1;
    const remaining = Math.floor(Math.max(0, b.tokens));
    return { ok: true, limit: b.capacity, remaining, resetSec: 1 };
  }
  const needed = 1 - b.tokens;
  const retryAfterSec = Math.ceil(needed / b.refillPerSec);
  const remaining = 0;
  return { ok: false, retryAfterSec, limit: b.capacity, remaining, resetSec: retryAfterSec };
}

export function clientKeyFromHeaders(headers: Headers): string {
  // Best-effort key: Use forwarded-for or host+user-agent fallback
  const fwd = headers.get("x-forwarded-for") || headers.get("x-real-ip") || "";
  const ip = fwd.split(",")[0]?.trim() || "0.0.0.0";
  const ua = headers.get("user-agent") || "unknown";
  return `${ip}|${ua}`;
}

// Test-only helper: reset buckets and optionally override config.
export function __rateLimitTestReset(opts?: { burst?: number; maxRps?: number }) {
  buckets.clear();
  if (opts) {
    if (typeof opts.burst === 'number' && opts.burst! > 0) _config.burst = Math.floor(opts.burst!);
    if (typeof opts.maxRps === 'number' && opts.maxRps! > 0) _config.maxRps = Math.floor(opts.maxRps!);
  }
}
