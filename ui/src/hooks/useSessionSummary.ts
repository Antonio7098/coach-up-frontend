"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type SessionSummary = {
  text: string;
  lastIndex?: number;
  updatedAt: number; // epoch ms
  version: number; // summary version
};

export type UseSessionSummaryResult = {
  summary: SessionSummary | null;
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  // Trigger a refresh regardless of thresholds
  refresh: () => Promise<void>;
  // Called when a new turn happens to maybe refresh based on thresholds
  onTurn: () => void;
  // Expose thresholds for diagnostics
  thresholds: { turns: number; seconds: number };
};

function storageKey(sessionId: string) {
  return `cu.sessionSummary:${sessionId}`;
}

function nowMs() { return Date.now(); }

function parseEnvInt(v: string | undefined, def: number): number {
  const n = Number(v ?? "");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

export function useSessionSummary(sessionId?: string | null): UseSessionSummaryResult {
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | undefined>(undefined);
  const turnsSinceRefreshRef = useRef<number>(0);

  const thresholds = useMemo(() => ({
    turns: parseEnvInt(process.env.NEXT_PUBLIC_SUMMARY_REFRESH_TURNS, 8),
    seconds: parseEnvInt(process.env.NEXT_PUBLIC_SUMMARY_REFRESH_SECONDS, 120),
  }), []);

  // Load from sessionStorage on session change
  useEffect(() => {
    setError(undefined);
    setStatus("idle");
    setSummary(null);
    turnsSinceRefreshRef.current = 0;
    if (!sessionId) return;
    try {
      const raw = sessionStorage.getItem(storageKey(sessionId));
      if (raw) {
        const parsed = JSON.parse(raw) as SessionSummary;
        if (parsed && typeof parsed.text === "string" && typeof parsed.updatedAt === "number") {
          const ageSec = Math.floor((nowMs() - parsed.updatedAt) / 1000);
          try { console.log(JSON.stringify({ type: "summary.cache", event: "hit", sessionId, updatedAt: parsed.updatedAt, ageSec })); } catch {}
          setSummary(parsed);
          setStatus("ready");
          return;
        }
      }
      try { console.log(JSON.stringify({ type: "summary.cache", event: "miss", sessionId })); } catch {}
    } catch {}
    // If nothing cached, kick off a background fetch
    void (async () => { await doFetch(); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const save = useCallback((sid: string, s: SessionSummary) => {
    try { sessionStorage.setItem(storageKey(sid), JSON.stringify(s)); } catch {}
  }, []);

  const doFetch = useCallback(async () => {
    if (!sessionId) return;
    setStatus((cur) => (cur === "ready" ? cur : "loading"));
    setError(undefined);
    const t0 = nowMs();
    try { console.log(JSON.stringify({ type: "summary.refresh", event: "start", sessionId })); } catch {}
    let ok = false;
    try {
      const reqId = Math.random().toString(36).slice(2);
      const res = await fetch(`/api/v1/session-summary?sessionId=${encodeURIComponent(sessionId)}`, {
        method: "GET",
        headers: { accept: "application/json", "x-request-id": reqId },
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      // Pull rate limit headers for observability
      const rl = {
        limit: res.headers.get("x-ratelimit-limit"),
        remaining: res.headers.get("x-ratelimit-remaining"),
        reset: res.headers.get("x-ratelimit-reset"),
        retryAfter: res.headers.get("retry-after"),
      };
      if (res.status === 404) {
        // No summary yet (cacheable-miss)
        try { console.log(JSON.stringify({ type: "summary.refresh", event: "not_found", sessionId, status: res.status, rl })); } catch {}
        setStatus("ready");
        setSummary(null);
        ok = true;
        return;
      }
      if (!res.ok) {
        try { console.log(JSON.stringify({ type: "summary.refresh", event: "http_error", sessionId, status: res.status, rl })); } catch {}
        throw new Error(data?.error || `summary fetch failed: ${res.status}`);
      }
      const next: SessionSummary = {
        text: String(data?.text || data?.summary?.text || ""),
        lastIndex: typeof data?.lastIndex === "number" ? data.lastIndex : undefined,
        updatedAt: typeof data?.updatedAt === "number" ? data.updatedAt : nowMs(),
        version: typeof data?.version === "number" ? data.version : 2,
      };
      setSummary(next);
      save(sessionId, next);
      setStatus("ready");
      ok = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus((cur) => (cur === "ready" ? cur : "error"));
    } finally {
      try { console.log(JSON.stringify({ type: "summary.refresh", event: "end", ok, dtMs: nowMs() - t0, sessionId })); } catch {}
      turnsSinceRefreshRef.current = 0;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const refresh = useCallback(async () => { await doFetch(); }, [doFetch]);

  const onTurn = useCallback(() => {
    if (!sessionId) return;
    const turns = (turnsSinceRefreshRef.current = (turnsSinceRefreshRef.current || 0) + 1);
    const ageSec = summary ? Math.floor((nowMs() - (summary.updatedAt || 0)) / 1000) : Number.MAX_SAFE_INTEGER;
    const should = turns >= thresholds.turns || ageSec >= thresholds.seconds;
    try { console.log(JSON.stringify({ type: "summary.turn", turns, ageSec, should })); } catch {}
    if (should) void doFetch();
  }, [doFetch, sessionId, summary, thresholds.seconds, thresholds.turns]);

  return { summary, status, error, refresh, onTurn, thresholds };
}
