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
    const qs = p && p.length > 0 ? `?prompt=${encodeURIComponent(p)}` : "";
    const url = `/api/chat${qs}`;
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
  }, [append, disconnect, ingestMessage]);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      disconnect();
    };
  }, [disconnect]);

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
    <div className="mx-auto max-w-2xl p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Chat Stream (SSE)</h1>
      <p className="text-sm text-gray-500">AI API: {AI_API_BASE_URL}</p>
      <div className="text-sm">
        <Link href="/chat/voice" className="text-blue-600 underline">
          Try Voice Mode →
        </Link>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          // Ingest the user message immediately when sending
          void ingestMessage("user", prompt);
          connect(prompt);
          // Optional UX: clear input after send
          setPrompt("");
        }}
        className="flex items-center gap-3"
      >
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Type a prompt…"
          className="flex-1 rounded border px-3 py-1.5"
        />
        <button
          type="submit"
          className="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
          disabled={!sessionId || status === "connecting" || status === "open" || status === "retrying" || prompt.length === 0}
        >
          Send
        </button>
        <button
          type="button"
          onClick={disconnect}
          className="rounded bg-gray-200 px-3 py-1.5 hover:bg-gray-300"
        >
          Cancel
        </button>
      </form>

      <div className="flex items-center gap-2 text-sm">
        <span
          className={`inline-flex items-center rounded px-2 py-0.5 font-mono ${
            status === "open"
              ? "bg-green-100 text-green-700"
              : status === "connecting"
              ? "bg-yellow-100 text-yellow-700"
              : status === "retrying"
              ? "bg-orange-100 text-orange-700"
              : status === "closed"
              ? "bg-gray-100 text-gray-700"
              : "bg-slate-100 text-slate-700"
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
          className="rounded bg-gray-100 px-2 py-1 hover:bg-gray-200"
        >
          Clear
        </button>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Output</label>
        <textarea
          className="h-64 w-full resize-none rounded border p-2 font-mono"
          readOnly
          value={output}
        />
      </div>

      <div className="text-sm text-gray-600 space-y-1">
        <div>
          First token: {firstTokenMs != null ? `${firstTokenMs} ms` : "–"}
        </div>
        <div>
          Total: {totalMs != null ? `${totalMs} ms` : "–"}
        </div>
        {startedAt != null && (
          <div className="text-xs text-gray-400">
            Started at: {new Date(startedAt).toLocaleTimeString()}
          </div>
        )}
      </div>

      <div className="text-xs text-gray-500">
        Notes: This demo uses native EventSource, which cannot send custom headers. The server generates a request ID for logs; the client prints a final [DONE] marker when streaming ends.
      </div>

      <div className="mt-8 border-t pt-4 space-y-3">
        <h2 className="text-lg font-semibold">Assessments (SPR-002 demo)</h2>
        <div className="text-sm text-gray-600">
          Session ID: <code className="font-mono">{sessionId || "(initializing…)"}</code>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={runAssessment}
            disabled={assessRunning || !sessionId}
            className="rounded bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {assessRunning ? "Running…" : "Run Assessment"}
          </button>
          <button
            type="button"
            onClick={fetchSummary}
            disabled={!sessionId}
            className="rounded bg-gray-200 px-3 py-1.5 hover:bg-gray-300"
          >
            Fetch Summary
          </button>
          {groupId && (
            <span className="text-xs text-gray-500">groupId: <code className="font-mono">{groupId}</code></span>
          )}
        </div>
        {summary && (
          <div className="rounded border p-3 text-sm space-y-2">
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
