"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { useSessionSummary } from "../../hooks/useSessionSummary";
import { useMinimalSession } from "./MinimalSessionContext";

export type MinimalConversationContextValue = {
  chatToText: (prompt: string) => Promise<string>;
  getImmediateHistory: () => Array<{ role: "user" | "assistant"; content: string }>;
  getSummaryMeta: () => { ready: boolean; updatedAt?: number; turnsUntilDue: number; thresholdTurns: number };
};

const Ctx = createContext<MinimalConversationContextValue | undefined>(undefined);

export function useMinimalConversation() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMinimalConversation must be used within MinimalConversationProvider");
  return ctx;
}

export function MinimalConversationProvider({ children }: { children: React.ReactNode }) {
  // Minimal in-memory history of last 2 messages (role: user|assistant)
  const historyRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const { sessionId } = useMinimalSession();
  const { summary, onTurn, thresholds } = useSessionSummary(sessionId, { autoloadOnMount: false });
  const [turnsSinceRefresh, setTurnsSinceRefresh] = React.useState<number>(0);
  const lastUpdatedRef = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    const upd = typeof summary?.updatedAt === "number" ? summary.updatedAt : undefined;
    if (upd && upd !== lastUpdatedRef.current) {
      lastUpdatedRef.current = upd;
      setTurnsSinceRefresh(0);
    }
  }, [summary?.updatedAt]);

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

  const chatToText = useCallback(async (prompt: string): Promise<string> => {
    if (!prompt || !prompt.trim()) return "";
    // Build minimal history param from the last 2 messages (excluding this prompt)
    const last2 = historyRef.current.slice(-2).map((m) => ({ role: m.role, content: (m.content || "").slice(0, 240) }));
    const sys = (summary?.text || "").trim();
    const items = sys ? ([{ role: "system", content: sys.slice(0, 480) }] as const).concat(last2 as any) : last2;
    const histParam = items.length ? `&history=${encodeURIComponent(toBase64Url(JSON.stringify(items)))}` : "";

    const startOnce = (): Promise<string | null> => new Promise((resolve, reject) => {
      try {
        let es: EventSource | null = null;
        try { es = new EventSource(`/api/chat?prompt=${encodeURIComponent(prompt)}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ""}${histParam}`, { withCredentials: false }); } catch {}
        if (!es) { reject(new Error("stream failed")); return; }
        let acc = "";
        es.onmessage = (evt) => {
          if (evt.data === "[DONE]") { try { es?.close(); } catch {}; resolve(acc); }
          else { acc += evt.data; }
        };
        es.onerror = () => {
          try { es?.close(); } catch {}
          if (acc) resolve(acc); else resolve(null);
        };
      } catch (e: any) {
        reject(new Error(e?.message || "stream failed"));
      }
    });
    const first = await startOnce();
    if (typeof first === "string") return first;
    const second = await startOnce();
    if (typeof second === "string") return second;
    throw new Error("stream failed");
  }, []);

  // Push user/assistant messages into minimal history when chatToText resolves
  const chatToTextWithHistory = useCallback(async (prompt: string): Promise<string> => {
    const reply = await chatToText(prompt);
    try {
      historyRef.current.push({ role: "user", content: prompt });
      historyRef.current.push({ role: "assistant", content: reply });
      // Keep only last 2
      if (historyRef.current.length > 2) historyRef.current = historyRef.current.slice(-2);
      // Trigger background summary refresh according to thresholds (non-blocking)
      try { onTurn(); } catch {}
      setTurnsSinceRefresh((n) => (Number.isFinite(n) ? n + 1 : 1));
      // Persist interactions (user + assistant) to enable backend cadence even without mic
      try {
        const sid = (sessionId || '').toString();
        if (sid) {
          const now = Date.now();
          const reqId = Math.random().toString(36).slice(2);
          const djb2 = (input: string): string => {
            const s = (input || '').trim();
            if (s.length === 0) return '0';
            let h = 5381; for (let i = 0; i < s.length; i++) { h = ((h << 5) + h) ^ s.charCodeAt(i); }
            return (h >>> 0).toString(16);
          };
          // user
          try { console.log('[ingest] POST user', { sid, len: prompt.length }); } catch {}
          void fetch('/api/v1/interactions', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-request-id': reqId },
            body: JSON.stringify({ sessionId: sid, messageId: `c_user_${now}`, role: 'user', contentHash: djb2(prompt || `c_user_${now}`), text: prompt, ts: now })
          }).catch(() => {});
          // assistant
          try { console.log('[ingest] POST assistant', { sid, len: reply.length }); } catch {}
          void fetch('/api/v1/interactions', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-request-id': reqId },
            body: JSON.stringify({ sessionId: sid, messageId: `c_assistant_${now+1}`, role: 'assistant', contentHash: djb2(reply || `c_assistant_${now+1}`), text: reply, ts: now + 1 })
          }).catch(() => {});
        }
      } catch {}
    } catch {}
    return reply;
  }, [chatToText, onTurn, sessionId]);

  const getImmediateHistory = useCallback(() => {
    return historyRef.current.slice(-2);
  }, []);

  const getSummaryMeta = useCallback(() => {
    const ready = !!(summary && typeof summary.text === "string" && summary.text.trim().length > 0);
    const thresholdTurns = thresholds?.turns ?? 8;
    const turnsUntilDue = Math.max(0, thresholdTurns - (Number.isFinite(turnsSinceRefresh) ? turnsSinceRefresh : 0));
    return { ready, updatedAt: summary?.updatedAt, turnsUntilDue, thresholdTurns };
  }, [summary, thresholds?.turns, turnsSinceRefresh]);

  const value = useMemo<MinimalConversationContextValue>(() => ({ chatToText: chatToTextWithHistory, getImmediateHistory, getSummaryMeta }), [chatToTextWithHistory, getImmediateHistory, getSummaryMeta]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}


