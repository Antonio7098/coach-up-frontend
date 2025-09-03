"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { useSessionSummary } from "../../hooks/useSessionSummary";
import { useMinimalSession } from "./MinimalSessionContext";
import { useAuth } from "@clerk/nextjs";

export type PromptPreview = {
  system?: string;
  summary?: string;
  summaryLen?: number;
  recentMessages?: Array<{ role: string; content: string; len: number }>;
  prompt?: string;
  createdAt?: number;
} | null;

export type MinimalConversationContextValue = {
  chatToText: (prompt: string, options?: { userProfile?: any; userGoals?: any[]; customSystemPrompt?: string; model?: string; onModelUsed?: (model: string, provider: string) => void }) => Promise<string>;
  chatToTextStreaming: (prompt: string, onChunk?: (chunk: string) => void, options?: { userProfile?: any; userGoals?: any[]; customSystemPrompt?: string; model?: string; onModelUsed?: (model: string, provider: string) => void }) => Promise<string>;
  chatToTextStreamingWithHistory: (prompt: string, onChunk?: (chunk: string) => void, options?: { userProfile?: any; userGoals?: any[]; customSystemPrompt?: string; model?: string; onModelUsed?: (model: string, provider: string) => void }) => Promise<string>;
  getImmediateHistory: () => Array<{ role: "user" | "assistant"; content: string }>;
  getSummaryMeta: () => { ready: boolean; updatedAt?: number; turnsUntilDue: number; thresholdTurns: number };
  getLastPromptPreview: () => PromptPreview;
  refreshPromptPreview: () => Promise<void>;
  promptPreview: PromptPreview;
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
  const { getToken } = useAuth();

  const buildAuthHeaders = useCallback(async (base: HeadersInit = {}): Promise<HeadersInit> => {
    try {
      const token = await getToken();
      if (token) return { ...base, Authorization: `Bearer ${token}` };
    } catch {}
    return base;
  }, [getToken]);
  const [turnsSinceRefresh, setTurnsSinceRefresh] = React.useState<number>(0);
  const lastUpdatedRef = React.useRef<number | undefined>(undefined);
  const lastRidRef = React.useRef<string | null>(null);
  const [promptPreview, setPromptPreview] = React.useState<PromptPreview>(null);
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

  // Deprecated: preview GET is removed; SSE 'prompt' event is source of truth.
  const fetchPromptPreview = useCallback(async (_rid: string) => { return; }, []);

  const chatToTextStreaming = useCallback(async (prompt: string, onChunk?: (chunk: string) => void, options?: { userProfile?: any; userGoals?: any[]; customSystemPrompt?: string; model?: string; onModelUsed?: (model: string, provider: string) => void }): Promise<string> => {
    if (!prompt || !prompt.trim()) return "";
    // Build minimal history param from the last 2 messages (excluding this prompt)
    const last2 = historyRef.current.slice(-2).map((m) => ({ role: m.role, content: (m.content || "").slice(0, 240) }));
    const sys = (summary?.text || "").trim();
    const items = sys ? ([{ role: "system", content: sys.slice(0, 480) }] as const).concat(last2 as any) : last2;
    const histParam = items.length ? `&history=${encodeURIComponent(toBase64Url(JSON.stringify(items)))}` : "";

    // Build user profile and goals parameters
    let profileParam = "";
    let goalsParam = "";
    if (options?.userProfile) {
      try {
        profileParam = `&userProfile=${encodeURIComponent(toBase64Url(JSON.stringify(options.userProfile)))}`;
      } catch (e) {
        console.warn("Failed to encode user profile:", e);
      }
    }
    if (options?.userGoals && Array.isArray(options?.userGoals)) {
      try {
        goalsParam = `&userGoals=${encodeURIComponent(toBase64Url(JSON.stringify(options.userGoals)))}`;
      } catch (e) {
        console.warn("Failed to encode user goals:", e);
      }
    }

    const rid = Math.random().toString(36).slice(2);
    lastRidRef.current = rid;
    setPromptPreview(null);

    const startStreaming = (): Promise<string | null> => new Promise((resolve, reject) => {
      try {
        let es: EventSource | null = null;
        try {
          // Add custom system prompt if provided
          let systemPromptParam = "";
          if (options?.customSystemPrompt && options.customSystemPrompt.trim()) {
            systemPromptParam = `&systemPrompt=${encodeURIComponent(options.customSystemPrompt.trim())}`;

          }

          // Add model parameter if provided
          let modelParam = "";
          if (options?.model && options.model.trim()) {
            modelParam = `&model=${encodeURIComponent(options.model.trim())}`;
          }

          const url = `/api/chat?prompt=${encodeURIComponent(prompt)}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ""}${histParam}${profileParam}${goalsParam}${systemPromptParam}${modelParam}&rid=${encodeURIComponent(rid)}&debug=1`;

          es = new EventSource(url, { withCredentials: false });
        } catch {}
        if (!es) { reject(new Error("stream failed")); return; }
        let acc = "";
        let chunkCount = 0;
        es.onmessage = (evt) => {
          if (evt.data === "[DONE]") {
            try {
              // Streaming complete
              es?.close();
            } catch {};
            resolve(acc);
          } else {
            acc += evt.data;
            chunkCount++;
            // Stream chunk received
            // Call the chunk callback for streaming TTS
            if (onChunk && evt.data) {
              onChunk(evt.data);
            }
          }
        };
        es.addEventListener('prompt', (evt: MessageEvent) => {
          try {
            const data = JSON.parse(evt.data || '{}');
            setPromptPreview({
              system: typeof data?.system === 'string' ? data.system : '',
              summary: undefined,
              summaryLen: undefined,
              recentMessages: undefined,
              prompt: typeof data?.rendered === 'string' ? data.rendered : (typeof data?.user === 'string' ? data.user : ''),
              createdAt: Date.now(),
            });
          } catch {}
        });
        es.addEventListener('model', (evt: MessageEvent) => {
          try {
            const data = JSON.parse(evt.data || '{}');
            const model = typeof data?.model === 'string' ? data.model : '';
            const provider = typeof data?.provider === 'string' ? data.provider : '';
            if (model && provider && options?.onModelUsed) {
              options.onModelUsed(model, provider);
            }
          } catch {}
        });
        es.onerror = () => {
          try { es?.close(); } catch {}
          if (acc) resolve(acc); else resolve(null);
        };
      } catch (e: any) {
        reject(new Error(e?.message || "stream failed"));
      }
    });
    const first = await startStreaming();
    if (typeof first === "string") return first;
    const second = await startStreaming();
    if (typeof second === "string") return second;
    throw new Error("stream failed");
  }, [sessionId, summary?.text]);

  const chatToText = useCallback(async (prompt: string, options?: { userProfile?: any; userGoals?: any[]; customSystemPrompt?: string; model?: string; onModelUsed?: (model: string, provider: string) => void }): Promise<string> => {
    return chatToTextStreaming(prompt, undefined, options);
  }, [chatToTextStreaming]);

  // Push user/assistant messages into minimal history when chatToText resolves
  const chatToTextWithHistory = useCallback(async (prompt: string, options?: { userProfile?: any; userGoals?: any[]; customSystemPrompt?: string; model?: string; onModelUsed?: (model: string, provider: string) => void }): Promise<string> => {
    const reply = await chatToText(prompt, options);
    try {
      const beforeLength = historyRef.current.length;
      historyRef.current.push({ role: "user", content: prompt });
      historyRef.current.push({ role: "assistant", content: reply });
      // Keep only last 2
      if (historyRef.current.length > 2) historyRef.current = historyRef.current.slice(-2);

      console.log("MinimalConversation: History updated", {
        beforeLength,
        afterLength: historyRef.current.length,
        userMessage: prompt?.substring(0, 50) + (prompt?.length > 50 ? "..." : ""),
        assistantReply: reply?.substring(0, 50) + (reply?.length > 50 ? "..." : ""),
        recentHistory: historyRef.current.map(m => `${m.role}: ${m.content?.substring(0, 30)}...`)
      });
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
          void (async () => {
            const headers = await buildAuthHeaders({ 'content-type': 'application/json', 'x-request-id': reqId });
            await fetch('/api/v1/interactions', {
              method: 'POST',
              headers,
              body: JSON.stringify({ sessionId: sid, messageId: `c_user_${now}`, role: 'user', contentHash: djb2(prompt || `c_user_${now}`), text: prompt, ts: now })
            }).catch(() => {});
          })();
          // assistant
          try { console.log('[ingest] POST assistant', { sid, len: reply.length }); } catch {}
          void (async () => {
            const headers = await buildAuthHeaders({ 'content-type': 'application/json', 'x-request-id': reqId });
            await fetch('/api/v1/interactions', {
              method: 'POST',
              headers,
              body: JSON.stringify({ sessionId: sid, messageId: `c_assistant_${now+1}`, role: 'assistant', contentHash: djb2(reply || `c_assistant_${now+1}`), text: reply, ts: now + 1 })
            }).catch(() => {});
          })();
        }
      } catch {}
    } catch {}
    return reply;
  }, [chatToText, onTurn, sessionId]);

  // Streaming version that also updates history
  const chatToTextStreamingWithHistory = useCallback(async (prompt: string, onChunk?: (chunk: string) => void, options?: { userProfile?: any; userGoals?: any[]; customSystemPrompt?: string; model?: string; onModelUsed?: (model: string, provider: string) => void }): Promise<string> => {
    const reply = await chatToTextStreaming(prompt, onChunk, options);
    try {
      const beforeLength = historyRef.current.length;
      historyRef.current.push({ role: "user", content: prompt });
      historyRef.current.push({ role: "assistant", content: reply });
      // Keep only last 2
      if (historyRef.current.length > 2) historyRef.current = historyRef.current.slice(-2);

      // Streaming history updated
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
          try { console.log('[ingest] POST user streaming', { sid, len: prompt.length }); } catch {}
          void (async () => {
            const headers = await buildAuthHeaders({ 'content-type': 'application/json', 'x-request-id': reqId });
            await fetch('/api/v1/interactions', {
              method: 'POST',
              headers,
              body: JSON.stringify({ sessionId: sid, messageId: `c_user_stream_${now}`, role: 'user', contentHash: djb2(prompt || `c_user_stream_${now}`), text: prompt, ts: now })
            }).catch(() => {});
          })();
          // assistant
          try { console.log('[ingest] POST assistant streaming', { sid, len: reply.length }); } catch {}
          void (async () => {
            const headers = await buildAuthHeaders({ 'content-type': 'application/json', 'x-request-id': reqId });
            await fetch('/api/v1/interactions', {
              method: 'POST',
              headers,
              body: JSON.stringify({ sessionId: sid, messageId: `c_assistant_stream_${now+1}`, role: 'assistant', contentHash: djb2(reply || `c_assistant_stream_${now+1}`), text: reply, ts: now + 1 })
            }).catch(() => {});
          })();
        }
      } catch {}
    } catch {}
    return reply;
  }, [chatToTextStreaming, onTurn, sessionId]);

  const getImmediateHistory = useCallback(() => {
    const history = historyRef.current.slice(-2);
    try {
      // getImmediateHistory called
    } catch {}
    return history;
  }, []);

  const getSummaryMeta = useCallback(() => {
    const ready = !!(summary && typeof summary.text === "string" && summary.text.trim().length > 0);
    const thresholdTurns = thresholds?.turns ?? 8;
    const turnsUntilDue = Math.max(0, thresholdTurns - (Number.isFinite(turnsSinceRefresh) ? turnsSinceRefresh : 0));
    return { ready, updatedAt: summary?.updatedAt, turnsUntilDue, thresholdTurns };
  }, [summary, thresholds?.turns, turnsSinceRefresh]);

  const value = useMemo<MinimalConversationContextValue>(() => ({
    chatToText: chatToTextWithHistory,
    chatToTextStreaming: (prompt: string, onChunk?: (chunk: string) => void, options?: { userProfile?: any; userGoals?: any[]; customSystemPrompt?: string; model?: string; onModelUsed?: (model: string, provider: string) => void }) => chatToTextStreaming(prompt, onChunk, options),
    chatToTextStreamingWithHistory,
    getImmediateHistory,
    getSummaryMeta,
    getLastPromptPreview: () => promptPreview,
    refreshPromptPreview: async () => {},
    promptPreview,
  }), [chatToTextWithHistory, chatToTextStreaming, chatToTextStreamingWithHistory, getImmediateHistory, getSummaryMeta, promptPreview]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}


