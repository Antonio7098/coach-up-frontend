"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionSummary } from "../../hooks/useSessionSummary";

type Msg = { role: "user" | "assistant" | "system"; content: string };

function toBase64Url(data: string) {
  const b64 = typeof btoa === "function" ? btoa(data) : Buffer.from(data).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export default function ChatPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [assistantText, setAssistantText] = useState("");
  const esRef = useRef<EventSource | null>(null);
  const assistantTextRef = useRef("");
  const [lastEvent, setLastEvent] = useState("");

  // Resolve sessionId from URL if present; else a stable placeholder
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const sid = url.searchParams.get("sessionId");
      setSessionId(sid || "client-session");
    } catch {
      setSessionId("client-session");
    }
  }, []);

  const { summary } = useSessionSummary(sessionId);

  function storageKey(sid: string) {
    return `chat:history:${sid}`;
  }

  // Load persisted messages for this session
  useEffect(() => {
    if (!sessionId) return;
    try {
      const raw = localStorage.getItem(storageKey(sessionId));
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          const valid = arr.filter((m: any) => m && typeof m.content === "string" && ["user", "assistant", "system"].includes(m.role));
          setMessages(valid as Msg[]);
        }
      }
    } catch {}
  }, [sessionId]);

  // Persist messages whenever they change
  useEffect(() => {
    if (!sessionId) return;
    try {
      localStorage.setItem(storageKey(sessionId), JSON.stringify(messages));
    } catch {}
  }, [messages, sessionId]);

  const historyTurns = useMemo(() => {
    const M = Number(process.env.NEXT_PUBLIC_HISTORY_TURNS ?? 10);
    return Number.isFinite(M) && M > 0 ? Math.floor(M) : 10;
  }, []);

  const backendUrl = useMemo(() => '/api/chat', []);

  const buildHistoryParam = useCallback(() => {
    const h: Msg[] = [];
    if (summary?.text) h.push({ role: "system", content: summary.text });
    const tail = messages.slice(-historyTurns);
    h.push(...tail);
    const json = JSON.stringify(h);
    return toBase64Url(json);
  }, [messages, summary, historyTurns]);

  const startSSE = useCallback((userText: string) => {
    if (!sessionId) return;
    try { esRef.current?.close(); } catch {}
    setAssistantText("");
    assistantTextRef.current = "";
    // Build history including the just-submitted user message to avoid async state lag
    const h: Msg[] = [];
    if (summary?.text) h.push({ role: "system", content: summary.text });
    const newUser: Msg = { role: "user", content: userText };
    const tail = [...messages, newUser].slice(-historyTurns);
    h.push(...tail);
    const hist = toBase64Url(JSON.stringify(h));
    // Build absolute URL so tests can parse it with new URL(lastChatUrl)
    const url = new URL(`${backendUrl}?history=${encodeURIComponent(hist)}`, window.location.origin).toString();
    const es = new EventSource(url, { withCredentials: false });
    esRef.current = es;
    es.onmessage = (ev) => {
      const data = ev.data || "";
      setLastEvent(data);
      if (data === "[DONE]") {
        // Close stream and persist assistant turn
        try { es.close(); } catch {}
        esRef.current = null;
        setMessages((cur) => {
          const next: Msg[] = [...cur, { role: "assistant", content: (assistantTextRef.current || "") }];
          return next;
        });
        return;
      }
      // Stream chunk
      setAssistantText((cur) => {
        const next = cur + data;
        assistantTextRef.current = next;
        return next;
      });
    };
    es.onerror = () => {
      try { es.close(); } catch {}
      esRef.current = null;
    };
  }, [backendUrl, sessionId, messages, historyTurns, summary?.text]);

  const onSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setMessages((cur) => [...cur, { role: "user", content: text }]);
    setInput("");
    startSSE(text);
  }, [input, startSSE]);

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      try { esRef.current?.close(); } catch {}
      esRef.current = null;
    };
  }, []);

  return (
    <main style={{ padding: 16, maxWidth: 720, margin: "0 auto" }}>
      <h1>Chat</h1>
      <p>{sessionId ? `session: ${sessionId}` : "(initializing…)"}</p>
      {sessionId && (
        <div style={{ marginTop: 12 }}>
          {summary?.text ? (
            <div style={{ padding: 8, background: "#f6f6f6", borderRadius: 6 }}>
              <strong>Session summary</strong>
              <div style={{ whiteSpace: "pre-wrap" }}>{summary.text}</div>
            </div>
          ) : (
            <div style={{ padding: 8, background: "#fafafa", borderRadius: 6, color: "#666" }}>
              No summary yet.
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a prompt…"
              aria-label="Ask something…"
              style={{ width: "100%", padding: 8 }}
            />
            <button onClick={onSend} aria-label="Ask" style={{ marginTop: 8 }}>Send</button>
          </div>

          {assistantText ? (
            <div style={{ marginTop: 12, padding: 8, background: "#eef7ff", borderRadius: 6 }}>
              <strong>Assistant</strong>
              <div style={{ whiteSpace: "pre-wrap" }}>{assistantText}</div>
            </div>
          ) : null}

          {/* Expose last SSE event for E2E tests that await "[DONE]" visibility */}
          <div style={{ marginTop: 8, color: "#888" }}>{lastEvent}</div>
        </div>
      )}
    </main>
  );
}
