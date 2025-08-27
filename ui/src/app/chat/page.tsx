"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

const AI_API_BASE_URL = process.env.NEXT_PUBLIC_AI_API_BASE_URL || "http://127.0.0.1:8000";

function safeUUID(): string {
  try {
    const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
    return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

interface AssessmentSummary {
  highlights?: string[];
  recommendations?: string[];
  rubricVersion?: string;
  categories?: string[];
}

interface AssessmentSummaryResponse {
  summary?: AssessmentSummary;
  [key: string]: unknown;
}

export default function ChatPage() {
  const [status, setStatus] = useState<
    | "idle"
    | "connecting"
    | "open"
    | "retrying"
    | "closed"
  >( "idle");
  const [output, setOutput] = useState("");
  const [prompt, setPrompt] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [firstTokenMs, setFirstTokenMs] = useState<number | null>(null);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const [assessRunning, setAssessRunning] = useState(false);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [summary, setSummary] = useState<AssessmentSummaryResponse | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef<number>(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assistantBufferRef = useRef<string>("");
  const firstTokenSetRef = useRef<boolean>(false);
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  // Config state
  const [showConfig, setShowConfig] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [debugChunks, setDebugChunks] = useState<boolean>(false);

  // Simple model list; can be extended or fetched later
  const MODEL_OPTIONS: Array<{ value: string; label: string }> = [
    { value: "", label: "Default (server)" },
    { value: "openrouter/anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet (OpenRouter)" },
    { value: "openrouter/openai/gpt-4o-mini", label: "GPT-4o mini (OpenRouter)" },
    { value: "google/gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  ];

  // Generate a sessionId only on the client after mount to avoid SSR/client mismatch
  const [sessionId, setSessionId] = useState<string>("");
  useEffect(() => {
    try {
      const key = "chatSessionId";
      const existing = typeof window !== "undefined" ? window.sessionStorage.getItem(key) : null;
      if (existing && existing.length > 0) {
        setSessionId(existing);
        return;
      }
      const id = safeUUID();
      setSessionId(id);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(key, id);
      }
    } catch {
      // Fallback: still set a random id even if sessionStorage is unavailable
      const id = safeUUID();
      setSessionId(id);
    }
  }, []);

  const append = useCallback((text: string) => {
    setOutput((prev) => prev + text);
  }, []);

  const genId = useCallback((): string => {
    return safeUUID();
  }, []);

  const ingestMessage = useCallback(
    async (role: "user" | "assistant", content: string) => {
      try {
        if (!sessionId || !content) return;
        const payload = {
          sessionId,
          messageId: genId(),
          role,
          content,
          ts: Date.now(),
        };
        await fetch("/api/messages/ingest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (e) {
        console.error(e);
      }
    },
    [sessionId, genId]
  );

  // Base64url encode UTF-8 strings safely
  function toBase64Url(s: string): string {
    try {
      const bytes = new TextEncoder().encode(s);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const b64 = btoa(bin);
      return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    } catch {
      // Fallback for unexpected envs
      try {
        // Best-effort unicode handling
        const b64 = btoa(unescape(encodeURIComponent(s)));
        return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      } catch {
        return "";
      }
    }
  }

  function buildHistoryParam(): string {
    // Trim to last 10 messages, cap content to ~240 chars per message to keep URL small
    const maxN = 10;
    const items = historyRef.current.slice(-maxN).map((m) => ({
      role: m.role,
      content: (m.content || "").slice(0, 240),
    }));
    try {
      const json = JSON.stringify(items);
      return toBase64Url(json);
    } catch {
      return "";
    }
  }

  // Persist history per-session in localStorage
  function historyStorageKey(sid: string) {
    return `chatHistory:${sid}`;
  }

  function saveHistory() {
    try {
      if (!sessionId) return;
      const items = historyRef.current.slice(-10);
      localStorage.setItem(historyStorageKey(sessionId), JSON.stringify(items));
    } catch {}
  }

  useEffect(() => {
    // Load any persisted history when sessionId is ready
    if (!sessionId) return;
    try {
      const raw = localStorage.getItem(historyStorageKey(sessionId));
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          historyRef.current = arr
            .filter((x: any) => x && typeof x.content === "string" && (x.role === "user" || x.role === "assistant"))
            .slice(-10);
        }
      }
    } catch {}
    // Load persisted config
    try {
      const m = localStorage.getItem("chat:model");
      if (m) setSelectedModel(m);
    } catch {}
    try {
      const d = localStorage.getItem("chat:debugChunks");
      if (d != null) setDebugChunks(d === "1");
    } catch {}
  }, [sessionId]);

  const disconnect = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setStatus("closed");
    retryRef.current = 0;
  }, []);

  const connect = useCallback((p?: string) => {
    // Clean any previous connection
    disconnect();

    setStatus("connecting");
    // Use same-origin API proxy to avoid CORS
    const params = new URLSearchParams();
    if (p && p.length > 0) params.set("prompt", p);
    if (sessionId) params.set("session_id", sessionId);
    const hist = buildHistoryParam();
    if (hist) params.set("history", hist);
    if (selectedModel) params.set("model", selectedModel);
    const url = `/api/chat?${params.toString()}`;
    // Reset output/metrics
    setOutput("");
    setFirstTokenMs(null);
    setTotalMs(null);
    firstTokenSetRef.current = false;
    const t0 = Date.now();
    setStartedAt(t0);
    // Reset assistant buffer for a fresh assistant final message
    assistantBufferRef.current = "";
    const es = new EventSource(url, { withCredentials: false });
    esRef.current = es;

    es.onopen = () => {
      retryRef.current = 0;
      setStatus("open");
    };

    es.onmessage = (evt) => {
      // Server sends token chunks and a final [DONE]
      if (evt.data === "[DONE]") {
        // Fire-and-forget: ingest assistant final message after SSE completion
        const finalContent = assistantBufferRef.current;
        // Append to local history first (trim to last 10)
        if (finalContent && finalContent.length > 0) {
          historyRef.current.push({ role: "assistant", content: finalContent });
          if (historyRef.current.length > 10) {
            historyRef.current = historyRef.current.slice(-10);
          }
          // persist
          saveHistory();
        }
        void ingestMessage("assistant", finalContent);
        append("\n[DONE]\n");
        if (!firstTokenSetRef.current) {
          setFirstTokenMs(Date.now() - t0);
          firstTokenSetRef.current = true;
        }
        setTotalMs(Date.now() - t0);
        disconnect();
        return;
      }
      if (!firstTokenSetRef.current) {
        setFirstTokenMs(Date.now() - t0);
        firstTokenSetRef.current = true;
      }
      append(evt.data);
      if (debugChunks && evt.data) {
        try {
          console.debug("[chat] chunk", { len: evt.data.length });
        } catch {}
      }
      // Accumulate assistant tokens to build the final assistant message
      assistantBufferRef.current += evt.data;
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      // Exponential backoff with jitter
      retryRef.current += 1;
      const base = Math.min(1000 * 2 ** (retryRef.current - 1), 8000);
      const jitter = Math.floor(Math.random() * 400);
      const delay = base + jitter;
      setStatus("retrying");
      retryTimerRef.current = setTimeout(() => {
        connect();
      }, delay);
    };
  }, [append, disconnect, ingestMessage, sessionId, selectedModel, debugChunks]);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      disconnect();
    };
  }, [disconnect]);

  const onSubmit = useCallback(
    async (e?: React.FormEvent<HTMLFormElement>) => {
      if (e) e.preventDefault();
      const p = prompt.trim();
      if (!p || !sessionId) return;
      // Ingest user message first, then open SSE stream
      try {
        // Update local history buffer with the user message (trim to last 10)
        historyRef.current.push({ role: "user", content: p });
        if (historyRef.current.length > 10) {
          historyRef.current = historyRef.current.slice(-10);
        }
        // persist
        saveHistory();
        await ingestMessage("user", p);
      } catch (err) {
        console.error("ingest user failed", err);
      }
      connect(p);
      setPrompt("");
    },
    [prompt, sessionId, ingestMessage, connect]
  );

  const fetchSummary = useCallback(async () => {
    try {
      console.debug("[assess] fetch summary start", { sessionId });
      const res = await fetch(`/api/assessments/${encodeURIComponent(sessionId)}`);
      if (!res.ok) throw new Error(`get failed: ${res.status}`);
      const data = await res.json();
      setSummary(data);
      try {
        const count = Array.isArray((data as any)?.summary?.skillAssessments)
          ? ((data as any)?.summary?.skillAssessments as any[]).length
          : Array.isArray((data as any)?.skillAssessments)
          ? ((data as any)?.skillAssessments as any[]).length
          : 0;
        const reqId = res.headers.get("x-request-id") || undefined;
        console.debug("[assess] fetch summary ok", { sessionId, count, hasSummary: !!(data as any)?.summary, requestId: reqId });
      } catch {}
    } catch (e) {
      console.error("[assess] fetch summary error", e);
    }
  }, [sessionId]);

  const runAssessment = useCallback(async () => {
    try {
      setAssessRunning(true);
      setSummary(null);
      console.debug("[assess] queue start", { sessionId });
      const res = await fetch("/api/assessments/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) throw new Error(`run failed: ${res.status}`);
      const reqId = res.headers.get("x-request-id") || undefined;
      const data = await res.json();
      setGroupId(data.groupId ?? null);
      try {
        console.debug("[assess] queue done", { sessionId, groupId: data.groupId, requestId: reqId });
      } catch {}
      // Immediately fetch summary (stubbed in API for now)
      await fetchSummary();
    } catch (e) {
      console.error("[assess] queue error", e);
    } finally {
      setAssessRunning(false);
    }
  }, [sessionId, fetchSummary]);

return (
  <div className="mx-auto max-w-2xl p-6 space-y-4 bg-background text-foreground">
    <h1 className="text-2xl font-semibold">Chat Stream (SSE)</h1>
    <p className="text-sm cu-muted">AI API: {AI_API_BASE_URL}</p>
    <div className="flex items-center gap-3 text-sm">
      <Link href="/chat/voice" className="underline cu-accent-text">
        Try Voice Mode →
      </Link>
      <button
        type="button"
        onClick={() => setShowConfig(true)}
        className="rounded px-2 py-1 cu-surface border cu-border-surface hover:opacity-90"
        aria-haspopup="dialog"
      >
        Configure
      </button>
    </div>
    <form
      onSubmit={onSubmit}
      className="flex items-center gap-3"
    >
      <input
        type="text"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Type a prompt…"
        className="flex-1 rounded border cu-border-surface cu-surface px-3 py-1.5"
      />
      <button
        type="submit"
        className="rounded px-3 py-1.5 cu-accent-bg hover:opacity-90 disabled:opacity-50"
        disabled={!sessionId || status === "connecting" || status === "open" || status === "retrying" || prompt.length === 0}
      >
        Send
      </button>
      <button
        type="button"
        onClick={disconnect}
        className="rounded px-3 py-1.5 cu-accent-soft-bg text-foreground hover:opacity-90"
      >
        Cancel
      </button>
    </form>

    <div className="flex items-center gap-2 text-sm">
      <span
        className={`inline-flex items-center rounded px-2 py-0.5 font-mono ${
          status === "open"
            ? "cu-accent-soft-bg cu-accent-text"
            : "cu-surface border cu-border-surface cu-muted"
        }`}
      >
        {status}
      </span>
      <button
        type="button"
        onClick={() => {
          setOutput("");
          setFirstTokenMs(null);
          setTotalMs(null);
        }}
        className="rounded px-2 py-1 cu-surface border cu-border-surface hover:opacity-90"
      >
        Clear
      </button>
    </div>

    <div>
      <label className="mb-1 block text-sm font-medium">Output</label>
      <textarea
        className="h-64 w-full resize-none rounded border cu-border-surface cu-surface p-2 font-mono"
        readOnly
        value={output}
      />
    </div>

    <div className="text-sm cu-muted space-y-1">
      <div>
        First token: {firstTokenMs != null ? `${firstTokenMs} ms` : "–"}
      </div>
      <div>
        Total: {totalMs != null ? `${totalMs} ms` : "–"}
      </div>
      {startedAt != null && (
        <div className="text-xs cu-muted">
          Started at: {new Date(startedAt).toLocaleTimeString()}
        </div>
      )}
    </div>

    <div className="text-xs cu-muted">
      Notes: This demo uses native EventSource, which cannot send custom headers. The server generates a request ID for logs; the client prints a final [DONE] marker when streaming ends.
    </div>

    {/* Config Modal */}
    {showConfig && (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/40" onClick={() => setShowConfig(false)} />
        <div className="relative z-10 w-full max-w-lg rounded-lg border cu-border-surface cu-surface p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Chat Configuration</h2>
            <button
              type="button"
              onClick={() => setShowConfig(false)}
              className="rounded px-2 py-1 cu-accent-soft-bg hover:opacity-90"
            >
              Close
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">Model</label>
              <select
                className="w-full rounded border cu-border-surface px-3 py-1.5"
                value={selectedModel}
                onChange={(e) => {
                  const v = e.target.value;
                  setSelectedModel(v);
                  try { localStorage.setItem("chat:model", v); } catch {}
                }}
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.value || "default"} value={m.value}>{m.label}</option>
                ))}
              </select>
              <div className="text-xs cu-muted mt-1">
                The selected model will be sent as a <code>model</code> query parameter to <code>/api/chat</code> and passed through to the backend.
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="debugChunks"
                type="checkbox"
                checked={debugChunks}
                onChange={(e) => {
                  setDebugChunks(e.target.checked);
                  try { localStorage.setItem("chat:debugChunks", e.target.checked ? "1" : "0"); } catch {}
                }}
              />
              <label htmlFor="debugChunks" className="text-sm">Debug: log chunk sizes to console</label>
            </div>

            <div className="rounded border cu-border-surface p-3 space-y-1">
              <div className="text-sm font-medium">Voice Tuning</div>
              <div className="text-xs cu-muted">
                Voice parameters are configurable on the Voice page. Use this button to tune VAD/barge-in thresholds and inspect logs.
              </div>
              <Link href="/chat/voice" className="inline-block rounded px-2 py-1 cu-accent-bg text-sm hover:opacity-90">
                Open Voice Tuning
              </Link>
            </div>
          </div>
        </div>
      </div>
    )}

    <div className="mt-8 border-t cu-border-surface pt-4 space-y-3">
      <h2 className="text-lg font-semibold">Assessments (SPR-002 demo)</h2>
      <div className="text-sm cu-muted">
        Session ID: <code className="font-mono">{sessionId || "(initializing…)"}</code>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={runAssessment}
          disabled={assessRunning || !sessionId}
          className="rounded px-3 py-1.5 cu-accent-bg hover:opacity-90 disabled:opacity-50"
        >
          {assessRunning ? "Running…" : "Run Assessment"}
        </button>
        <button
          type="button"
          onClick={fetchSummary}
          disabled={!sessionId}
          className="rounded px-3 py-1.5 cu-accent-soft-bg text-foreground hover:opacity-90"
        >
          Fetch Summary
        </button>
        {groupId && (
          <span className="text-xs cu-muted">groupId: <code className="font-mono">{groupId}</code></span>
        )}
      </div>
      {summary && (
        <div className="rounded border cu-border-surface cu-surface p-3 text-sm space-y-2">
          <div className="font-medium">Summary</div>
          <div>Highlights: {summary.summary?.highlights?.join(", ") ?? "–"}</div>
          <div>Recommendations: {summary.summary?.recommendations?.join(", ") ?? "–"}</div>
          <div>Rubric: {summary.summary?.rubricVersion ?? "–"}</div>
          <div>Categories: {summary.summary?.categories?.join(", ") ?? "–"}</div>
        </div>
      )}
    </div>
  </div>
);
}
