"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const AI_API_BASE_URL = process.env.NEXT_PUBLIC_AI_API_BASE_URL || "http://localhost:8000";

export default function ChatPage() {
  const [status, setStatus] = useState<
    | "idle"
    | "connecting"
    | "open"
    | "retrying"
    | "closed"
  >( "idle");
  const [output, setOutput] = useState("");
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef<number>(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const append = useCallback((text: string) => {
    setOutput((prev) => prev + text);
  }, []);

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

  const connect = useCallback(() => {
    // Clean any previous connection
    disconnect();

    setStatus("connecting");
    // Use same-origin API proxy to avoid CORS
    const url = `/api/chat`;
    const es = new EventSource(url, { withCredentials: false });
    esRef.current = es;

    es.onopen = () => {
      retryRef.current = 0;
      setStatus("open");
    };

    es.onmessage = (evt) => {
      // Server sends token chunks and a final [DONE]
      if (evt.data === "[DONE]") {
        append("\n[DONE]\n");
        disconnect();
        return;
      }
      append(evt.data);
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
  }, [append, disconnect]);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      disconnect();
    };
  }, [disconnect]);

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Chat Stream (SSE)</h1>
      <p className="text-sm text-gray-500">AI API: {AI_API_BASE_URL}</p>

      <div className="flex items-center gap-3">
        <button
          onClick={connect}
          className="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
          disabled={status === "connecting" || status === "open" || status === "retrying"}
        >
          Connect
        </button>
        <button
          onClick={disconnect}
          className="rounded bg-gray-200 px-3 py-1.5 hover:bg-gray-300"
        >
          Disconnect
        </button>
        <span className="text-sm">Status: <span className="font-mono">{status}</span></span>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Output</label>
        <textarea
          className="h-64 w-full resize-none rounded border p-2 font-mono"
          readOnly
          value={output}
        />
      </div>

      <div className="text-xs text-gray-500">
        Notes: This demo uses native EventSource, which cannot send custom headers. The server generates a request ID for logs; the client prints a final [DONE] marker when streaming ends.
      </div>
    </div>
  );
}
