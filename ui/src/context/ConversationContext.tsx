"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useVoice } from "./VoiceContext";
import { useChat } from "./ChatContext";
import { useSessionSummary } from "../hooks/useSessionSummary";

export type ConversationContextValue = {
  // Client-passed chat entrypoint for text prompts (debug/helper)
  sendPrompt: (prompt: string) => Promise<string>;
  // Encoded base64url history parameter used by SSE chat
  getHistoryParam: () => string;
  // Chat with streaming and TTS flushing for voice flows
  chatToTextWithTTS: (prompt: string, opts?: { includeHistory?: boolean }) => Promise<string>;
  // Cancel any active chat SSE stream (used for barge-in)
  cancelActiveChatStream: () => void;
  // Multi-turn interaction state (for assessments orchestration UI)
  interactionState: "active" | "idle";
  interactionGroupId?: string;
  interactionTurnCount: number;
  assessmentChips: Array<{ id: string; status: "queued" | "done" | "error"; createdAt: number; summary?: any }>;
};

const ConversationCtx = createContext<ConversationContextValue | undefined>(undefined);

export function useConversation() {
  const ctx = useContext(ConversationCtx);
  if (!ctx) throw new Error("useConversation must be used within ConversationProvider");
  return ctx;
}

export function ConversationProvider({ children }: { children: React.ReactNode }) {
  const { sessionId } = useChat();
  const { summary } = useSessionSummary(sessionId, { autoloadOnMount: false });
  const { enqueueTTSSegment } = useVoice();

  // Local history ring (10 msgs) — mirrors MicContext shape for compatibility
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  // Track the active chat SSE stream for cancellation
  const activeChatEsRef = useRef<EventSource | null>(null);

  function historyStorageKey(sid: string) {
    return `chatHistory:${sid}`;
  }

  useEffect(() => {
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
  }, [sessionId]);

  function saveHistory() {
    try {
      if (!sessionId) return;
      const items = historyRef.current.slice(-10);
      localStorage.setItem(historyStorageKey(sessionId), JSON.stringify(items));
    } catch {}
  }

  function toBase64Url(s: string): string {
    try {
      const bytes = new TextEncoder().encode(s);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const b64 = btoa(bin);
      return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    } catch {
      try {
        const b64 = btoa(unescape(encodeURIComponent(s)));
        return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      } catch {
        return "";
      }
    }
  }

  const MAX_HISTORY_FOR_CONVO = (() => {
    const envN = Number(process.env.NEXT_PUBLIC_MESSAGE_CONTEXT_LENGTH ?? 0) || 2;
    const n = Math.max(1, Math.min(10, Math.floor(envN)));
    return n;
  })();

  const buildHistoryParam = useCallback((): string => {
    const maxN = MAX_HISTORY_FOR_CONVO;
    const base = historyRef.current.slice(-maxN).map((m) => ({
      role: m.role,
      content: (m.content || "").slice(0, 240),
    }));
    const sysText = (summary?.text || "").trim();
    const sys = sysText ? [{ role: "system", content: sysText.slice(0, 480) }] : [];
    const items = [...sys, ...base];
    try {
      const json = JSON.stringify(items);
      return toBase64Url(json);
    } catch {
      return "";
    }
  }, [summary]);

  const sendPrompt = useCallback(async (prompt: string): Promise<string> => {
    if (!prompt || !prompt.trim() || !sessionId) return "";
    // Update client-side history with the user message
    historyRef.current.push({ role: "user", content: prompt });
    if (historyRef.current.length > 10) historyRef.current = historyRef.current.slice(-10);
    saveHistory();

    return new Promise<string>((resolve, reject) => {
      try {
        const hist = buildHistoryParam();
        const qs = `?prompt=${encodeURIComponent(prompt)}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ""}${hist ? `&history=${encodeURIComponent(hist)}` : ""}`;
        // Cancel any previous active stream before starting a new one
        try { activeChatEsRef.current?.close(); } catch {}
        activeChatEsRef.current = null;
        let es: EventSource | null = null;
        try { es = new EventSource(`/api/chat${qs}`, { withCredentials: false }); } catch {}
        if (!es) { reject(new Error("chat stream failed")); return; }
        activeChatEsRef.current = es;
        let acc = "";
        es.onmessage = (evt) => {
          if (evt.data === "[DONE]") {
            try { es?.close(); } catch {}
            if (activeChatEsRef.current === es) activeChatEsRef.current = null;
            // Persist assistant message
            if (acc) {
              historyRef.current.push({ role: "assistant", content: acc });
              if (historyRef.current.length > 10) historyRef.current = historyRef.current.slice(-10);
              saveHistory();
            }
            resolve(acc);
            return;
          }
          acc += evt.data;
        };
        es.onerror = () => {
          try { es?.close(); } catch {}
          if (activeChatEsRef.current === es) activeChatEsRef.current = null;
          // If we have partial assistant text, persist and resolve with it
          if (acc) {
            try {
              historyRef.current.push({ role: "assistant", content: acc });
              if (historyRef.current.length > 10) historyRef.current = historyRef.current.slice(-10);
              saveHistory();
            } catch {}
            resolve(acc);
          } else {
            reject(new Error("chat stream failed"));
          }
        };
      } catch (e: any) {
        reject(new Error(e?.message || "chat stream failed"));
      }
    });
  }, [buildHistoryParam, sessionId]);

  const chatToTextWithTTS = useCallback(async (promptText: string, opts?: { includeHistory?: boolean }): Promise<string> => {
    if (!promptText || !promptText.trim() || !sessionId) return "";
    // Update client-side history with the user message
    historyRef.current.push({ role: "user", content: promptText });
    if (historyRef.current.length > 10) historyRef.current = historyRef.current.slice(-10);
    saveHistory();

    const attempt = (retry: boolean): Promise<string> => new Promise<string>((resolve, reject) => {
      try {
        const includeHistory = opts?.includeHistory !== false;
        const hist = includeHistory ? buildHistoryParam() : "";
        const qs = `?prompt=${encodeURIComponent(promptText)}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ""}${hist ? `&history=${encodeURIComponent(hist)}` : ""}`;
        // Cancel any previous active stream before starting a new one
        try { activeChatEsRef.current?.close(); } catch {}
        activeChatEsRef.current = null;
        let es: EventSource | null = null;
        try { es = new EventSource(`/api/chat${qs}`, { withCredentials: false }); } catch {}
        if (!es) { reject(new Error("chat stream failed")); return; }
        activeChatEsRef.current = es;
        let acc = "";
        let lastFlushed = 0;
        const minFlushChars = 12;
        let idleTimer: ReturnType<typeof setTimeout> | null = null;
        const cleanup = () => {
          try { es?.close(); } catch {}
          if (activeChatEsRef.current === es) activeChatEsRef.current = null;
          if (idleTimer) { try { clearTimeout(idleTimer); } catch {} idleTimer = null; }
        };
        const maybeFlush = (force = false) => {
          const pending = acc.slice(lastFlushed);
          if (!force) {
            if (pending.length < minFlushChars) return;
          }
          const segment = pending.trim();
          if (!segment) return;
          lastFlushed = acc.length;
          enqueueTTSSegment(segment);
        };
        const flushOnPunctuation = () => {
          // Only flush on clear terminal punctuation to avoid cutting off after a colon and newline
          const tail = acc.slice(lastFlushed);
          const idx = Math.max(tail.lastIndexOf("."), tail.lastIndexOf("!"), tail.lastIndexOf("?"));
          if (idx >= 0) {
            const cut = lastFlushed + idx + 1;
            const seg = acc.slice(lastFlushed, cut).trim();
            if (seg.length >= 1) {
              lastFlushed = cut;
              enqueueTTSSegment(seg);
            }
          }
        };
        es.onmessage = (evt) => {
          if (evt.data === "[DONE]") {
            cleanup();
            const tail = acc.slice(lastFlushed).trim();
            if (tail.length > 0) {
              enqueueTTSSegment(tail);
              lastFlushed = acc.length;
            }
            if (acc) {
              historyRef.current.push({ role: "assistant", content: acc });
              if (historyRef.current.length > 10) historyRef.current = historyRef.current.slice(-10);
              saveHistory();
            }
            resolve(acc);
            return;
          }
          acc += evt.data;
          flushOnPunctuation();
          if (idleTimer) { try { clearTimeout(idleTimer); } catch {} }
          // Restore lower idle delay for snappier TTS without extra grace logic
          idleTimer = setTimeout(() => { maybeFlush(false); }, 200);
        };
        es.onerror = () => {
          const hadAny = acc.length > 0;
          // Clean up current connection
          cleanup();
          // On error, flush any remaining unspoken text
          try {
            const tail = acc.slice(lastFlushed).trim();
            if (tail.length > 0) {
              enqueueTTSSegment(tail);
              lastFlushed = acc.length;
            }
          } catch {}
          if (hadAny) {
            try {
              historyRef.current.push({ role: "assistant", content: acc });
              if (historyRef.current.length > 10) historyRef.current = historyRef.current.slice(-10);
              saveHistory();
            } catch {}
            resolve(acc);
          } else if (retry) {
            // One-time quick retry to mitigate transient disconnects (e.g., Fast Refresh)
            setTimeout(() => {
              attempt(false).then(resolve).catch(reject);
            }, 200);
          } else {
            reject(new Error("chat stream failed"));
          }
        };
      } catch (e: any) {
        reject(new Error(e?.message || "chat stream failed"));
      }
    });

    return attempt(true);
  }, [buildHistoryParam, enqueueTTSSegment, sessionId]);

  const cancelActiveChatStream = useCallback(() => {
    try { activeChatEsRef.current?.close(); } catch {}
    activeChatEsRef.current = null;
  }, []);

  const value = useMemo<ConversationContextValue>(() => ({
    sendPrompt,
    getHistoryParam: buildHistoryParam,
    chatToTextWithTTS,
    cancelActiveChatStream,
    interactionState: "idle",
    interactionGroupId: undefined,
    interactionTurnCount: 0,
    assessmentChips: [],
  }), [
    sendPrompt,
    buildHistoryParam,
    chatToTextWithTTS,
    cancelActiveChatStream,
  ]);

  return <ConversationCtx.Provider value={value}>{children}</ConversationCtx.Provider>;
}
