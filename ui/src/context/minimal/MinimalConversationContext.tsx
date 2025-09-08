"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { useSessionSummary } from "../../hooks/useSessionSummary";
import { useInteractionsCache } from "../../hooks/useInteractionsCache";
import { useSummaryStatusCache } from "../../hooks/useSummaryStatusCache";
import { useMinimalSession } from "./MinimalSessionContext";
import { useAuth } from "@clerk/nextjs";
import { fetchWithRetry } from "../../app/api/lib/retry";

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
  chatToTextStreaming: (prompt: string, onChunk?: (chunk: string) => void, options?: { userProfile?: any; userGoals?: any[]; customSystemPrompt?: string; model?: string; onModelUsed?: (model: string, provider: string) => void; sessionId?: string }) => Promise<string>;
  chatToTextStreamingWithHistory: (prompt: string, onChunk?: (chunk: string) => void, options?: { userProfile?: any; userGoals?: any[]; customSystemPrompt?: string; model?: string; onModelUsed?: (model: string, provider: string) => void }) => Promise<string>;
  getImmediateHistory: () => Array<{ role: "user" | "assistant"; content: string }>;
  recordTurn: (userText: string, assistantText: string) => void;
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
  const { sessionId } = useMinimalSession();
  // Autoload summary so the first turn can include it in history/system
  const { summary, onTurn, thresholds } = useSessionSummary(sessionId, { autoloadOnMount: true });
  const { getToken } = useAuth();

  // Use the new interactions cache system
  const {
    interactions,
    latestId,
    isLoading: interactionsLoading,
    refresh: refreshInteractions,
    getRecentInteractions,
    sinceModeActive,
    lastFetchWasIncremental,
    lastFetchWas304,
    lastEtag,
  } = useInteractionsCache({
    sessionId: sessionId || '',
    staleTime: 5000, // 5 seconds
    revalidateOnFocus: true,
    debounceMs: 300
  });

  // Use the new summary status cache system
  const {
    status: summaryStatus,
    isLoading: summaryStatusLoading,
    refresh: refreshSummaryStatus,
    isDue,
    isInProgress,
    turnsSince,
    lastSummaryVersion
  } = useSummaryStatusCache({
    sessionId: sessionId || '',
    staleTime: 3000, // 3 seconds for summary status
    revalidateOnFocus: true,
    useLiteEndpoint: true
  });

  // Minimal in-memory history for backward compatibility (last 2 messages)
  const historyRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);

  // Refs to store cache refresh functions for trailer event handling
  const refreshFunctionsRef = React.useRef<{
    refreshInteractionsCache?: () => Promise<void>;
    refreshSummaryStatus?: () => Promise<void>;
  }>({});

  // Phase 2 telemetry: track last prefetch and cache refresh times
  const [lastPrefetchAt, setLastPrefetchAt] = React.useState<number | null>(null);
  const [lastInteractionsRefreshAt, setLastInteractionsRefreshAt] = React.useState<number | null>(null);
  const [lastSummaryStatusRefreshAt, setLastSummaryStatusRefreshAt] = React.useState<number | null>(null);

  // Reset in-memory history when session changes to avoid cross-session mixing
  React.useEffect(() => {
    try {
      // Clear history when a new session starts
      (historyRef.current as any) = [];
    } catch {}
  }, [sessionId]);

  // How many recent messages to include (bounded 1..10), respects NEXT_PUBLIC_MESSAGE_CONTEXT_LENGTH
  const MAX_HISTORY_FOR_CONVO = React.useMemo(() => {
    const envN = Number(process.env.NEXT_PUBLIC_MESSAGE_CONTEXT_LENGTH ?? 0) || 2;
    const n = Math.max(1, Math.min(10, Math.floor(envN)));
    return n;
  }, []);

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
  // Phase 2: stream-start prefetch cooldown gate (ms timestamp until which we skip)
  const prefetchGateRef = React.useRef<number>(0);
  // Track a single in-flight EventSource and a monotonically increasing request sequence
  const esRef = React.useRef<EventSource | null>(null);
  const seqRef = React.useRef<number>(0);
  const activeSessionRef = React.useRef<string | null>(null);

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

  const chatToTextStreaming = useCallback(async (prompt: string, onChunk?: (chunk: string) => void, options?: { userProfile?: any; userGoals?: any[]; customSystemPrompt?: string; model?: string; onModelUsed?: (model: string, provider: string) => void; sessionId?: string }): Promise<string> => {
    if (!prompt || !prompt.trim()) return "";
    // Use sessionId from options parameter first, then fall back to context
    const currentSessionId = options?.sessionId || sessionId;
    if (!currentSessionId) {
      console.warn("chatToTextStreaming: sessionId not available, cannot make request");
      return "";
    }
    console.log("chatToTextStreaming: Starting chat request", { prompt: prompt.substring(0, 50), sessionId: currentSessionId });
    // Build history from cached interactions (more comprehensive than in-memory history)
    const recentInteractions = getRecentInteractions(MAX_HISTORY_FOR_CONVO);
    const recent = recentInteractions
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: (m.text || "").slice(0, 240)
      }));

    // Fallback to in-memory history if cache is empty
    const fallbackHistory = historyRef.current.slice(-MAX_HISTORY_FOR_CONVO).map((m) => ({
      role: m.role,
      content: (m.content || "").slice(0, 240)
    }));

    const historyToUse = recent.length > 0 ? recent : fallbackHistory;
    // Ensure we have the freshest system summary:
    // 1) If we have a local summary, check the lite endpoint for a newer version.
    // 2) If newer, fetch the full summary text and use it.
    // 3) If no local summary text, do a one-shot full fetch as a fallback.
    let sys = (summary?.text || "").trim();
    let sysVersion = Number(summary?.version || 0);
    if (currentSessionId) {
      try {
        // Preflight: check lite for newer version
        const liteHeaders = await buildAuthHeaders({ accept: 'application/json', 'x-request-id': Math.random().toString(36).slice(2) });
        const liteRes = await fetch(`/api/v1/session-summary/lite?sessionId=${encodeURIComponent(currentSessionId)}`, { method: 'GET', headers: liteHeaders, cache: 'no-store' });
        const lite = await liteRes.json().catch(() => ({} as any));
        const liteVer = Number(lite?.lastSummary?.version || 0);
        if (liteRes.ok && Number.isFinite(liteVer) && liteVer > sysVersion) {
          // Fetch full for newest text
          const fullHeaders = await buildAuthHeaders({ accept: 'application/json', 'x-request-id': Math.random().toString(36).slice(2) });
          const fullRes = await fetch(`/api/v1/session-summary?sessionId=${encodeURIComponent(currentSessionId)}`, { method: 'GET', headers: fullHeaders, cache: 'no-store' });
          const full = await fullRes.json().catch(() => ({} as any));
          if (fullRes.ok) {
            const txt = String(full?.text || full?.summary?.text || '').trim();
            if (txt) {
              sys = txt;
              sysVersion = liteVer;
            }
          }
        }
      } catch {}
    }
    // Fallback: if still empty, try one-shot full fetch
    if (!sys && currentSessionId) {
      try {
        const headers = await buildAuthHeaders({ accept: "application/json", 'x-request-id': Math.random().toString(36).slice(2) });
        const res = await fetch(`/api/v1/session-summary?sessionId=${encodeURIComponent(currentSessionId)}`, { method: 'GET', headers, cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (res.ok) sys = String(data?.text || data?.summary?.text || "").trim();
      } catch {}
    }
    const items = sys ? ([{ role: "system", content: sys.slice(0, 480) }] as const).concat(historyToUse as any) : historyToUse;
    
    // Debug logging
    console.log("[MinimalConversationContext] chatToTextStreaming history building:", {
      historyLength: historyRef.current.length,
      lastN: MAX_HISTORY_FOR_CONVO,
      recentLength: recent.length,
      sysLength: sys.length,
      totalItems: items.length,
      items: items.map(item => ({ role: item.role, contentLength: item.content.length, contentPreview: item.content.substring(0, 50) + "..." }))
    });
    
    const histParam = items.length ? `&history=${encodeURIComponent(toBase64Url(JSON.stringify(items)))}` : "";
    
    console.log("[MinimalConversationContext] chatToTextStreaming histParam:", {
      histParamLength: histParam.length,
      histParamPreview: histParam.substring(0, 100) + "..."
    });

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

    // Increment sequence and close any previous EventSource (latest-wins)
    const seq = ++seqRef.current;
    activeSessionRef.current = currentSessionId || null;
    try { if (esRef.current) { try { esRef.current.close(); } catch {}; esRef.current = null; } } catch {}

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

          const url = `/api/chat?prompt=${encodeURIComponent(prompt)}${currentSessionId ? `&sessionId=${encodeURIComponent(currentSessionId)}` : ""}${histParam}${profileParam}${goalsParam}${systemPromptParam}${modelParam}&rid=${encodeURIComponent(rid)}&debug=1`;

          console.log("chatToTextStreaming: Making EventSource request to", url);
          es = new EventSource(url, { withCredentials: false });
          esRef.current = es;
        } catch {}
        if (!es) { reject(new Error("stream failed")); return; }
        let acc = "";
        let chunkCount = 0;
es.onmessage = (evt) => {
          // Ignore if a newer request has started
          if (seq !== seqRef.current || (activeSessionRef.current || null) !== (currentSessionId || null)) {
            return;
          }
          if (evt.data === "[DONE]") {
            try {
              console.log('[SSE] done', { rid, seq, chunks: chunkCount, totalLen: acc.length });
              es?.close();
              if (esRef.current === es) esRef.current = null;
            } catch {};
            resolve(acc);
          } else {
            acc += evt.data;
            chunkCount++;
            if (chunkCount === 1) {
              try { console.log('[SSE] first-chunk', { rid, seq, firstLen: evt.data.length }); } catch {}
            }
            // Stream chunk received
            // Call the chunk callback for streaming TTS
            if (onChunk && evt.data) {
              onChunk(evt.data);
            }
          }
        };
es.addEventListener('prompt', (evt: MessageEvent) => {
          try {
            // Ignore if stale
            if (seq !== seqRef.current || (activeSessionRef.current || null) !== (currentSessionId || null)) return;
            const data = JSON.parse(evt.data || '{}');
            try { console.log('[SSE] prompt event', { rid, seq, hasRendered: !!data?.rendered, sysLen: (data?.system || '').length }); } catch {}
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
        es.addEventListener('trailer', (evt: MessageEvent) => {
          try {
            const data = JSON.parse(evt.data || '{}');
            console.log("chatToTextStreaming: Received trailer event", data);

            // Update interaction cache with latest interaction ID
            if (data?.latestInteractionId && currentSessionId) {
              try {
                // Trigger cache refresh to include the new interaction
                console.log("Trailer: Refreshing interactions cache for new interaction", data.latestInteractionId);
                // Use setTimeout to avoid blocking the stream completion
                setTimeout(() => {
                  try {
                    // Access the refresh functions through the ref
                    if (refreshFunctionsRef.current?.refreshInteractionsCache) {
                      refreshFunctionsRef.current.refreshInteractionsCache();
                    }
                  } catch (e) {
                    console.warn("Failed to refresh interactions cache:", e);
                  }
                }, 100);
              } catch (e) {
                console.warn("Failed to trigger interactions cache refresh:", e);
              }
            }

            // Update summary status cache with trailer data
            if (data?.summaryStatusLite && currentSessionId) {
              try {
                // Update the summary status cache with the trailer data
                // This eliminates the need for a separate summary status fetch
                console.log("Trailer: Refreshing summary status cache with trailer data");
                setTimeout(() => {
                  try {
                    // Access the refresh functions through the ref
                    if (refreshFunctionsRef.current?.refreshSummaryStatus) {
                      refreshFunctionsRef.current.refreshSummaryStatus();
                    }
                  } catch (e) {
                    console.warn("Failed to refresh summary status cache:", e);
                  }
                }, 100);
              } catch (e) {
                console.warn("Failed to trigger summary status cache refresh:", e);
              }
            }
          } catch (e) {
            console.warn("Failed to parse trailer event:", e);
          }
        });
es.onerror = (error) => {
          // Ignore if stale
          if (seq !== seqRef.current || (activeSessionRef.current || null) !== (currentSessionId || null)) {
            try { es?.close(); } catch {}
            if (esRef.current === es) esRef.current = null;
            return;
          }
          console.error("chatToTextStreaming: EventSource error", error);
          try { es?.close(); } catch {}
          if (esRef.current === es) esRef.current = null;
          if (acc) resolve(acc); else resolve(null);
        };
        es.onopen = () => {
          // Ignore if stale
          if (seq !== seqRef.current || (activeSessionRef.current || null) !== (currentSessionId || null)) return;
          try { console.log('[SSE] open', { rid, seq }); } catch {}
          // Phase 2: on stream start, prefetch interactions and summary status if allowed by cooldown
          const now = Date.now();
          if (prefetchGateRef.current && now < prefetchGateRef.current) {
            try { console.log('[prefetch] skip (cooldown)', { rid, untilMs: prefetchGateRef.current - now }); } catch {}
          } else {
            prefetchGateRef.current = now + 1500; // 1.5s cooldown window
            try {
              console.log('[prefetch] start', { rid, sessionId: currentSessionId });
              setLastPrefetchAt(now);
            } catch {}
            // Fire-and-forget background refreshes; respect internal staleTime/de-dupe
            setTimeout(() => {
              try {
                refreshFunctionsRef.current?.refreshInteractionsCache?.();
              } catch (e) {
                try { console.warn('[prefetch] interactions error', { err: e instanceof Error ? e.message : String(e) }); } catch {}
              }
            }, 0);
            setTimeout(() => {
              try {
                refreshFunctionsRef.current?.refreshSummaryStatus?.();
              } catch (e) {
                try { console.warn('[prefetch] summary-status error', { err: e instanceof Error ? e.message : String(e) }); } catch {}
              }
            }, 50);
            setTimeout(() => {
              try { console.log('[prefetch] queued'); } catch {}
            }, 0);
          }
        };
      } catch (e: any) {
        reject(new Error(e?.message || "stream failed"));
      }
    });
    const first = await startStreaming();
    if (typeof first === "string") return first;
    // If first attempt failed without data, try once more (network flake)
    const second = await startStreaming();
    if (typeof second === "string") return second;
    throw new Error("stream failed");
  }, [sessionId, summary?.text]);

  const chatToText = useCallback(async (prompt: string, options?: { userProfile?: any; userGoals?: any[]; customSystemPrompt?: string; model?: string; onModelUsed?: (model: string, provider: string) => void }): Promise<string> => {
    return chatToTextStreaming(prompt, undefined, options);
  }, [chatToTextStreaming]);

  // Allow external callers (Mic) to record a completed turn into local history without persisting to backend
  const recordTurn = useCallback((userText: string, assistantText: string) => {
    try {
      if (typeof userText === 'string' && userText.trim()) {
        historyRef.current.push({ role: 'user', content: userText });
      }
      if (typeof assistantText === 'string' && assistantText.trim()) {
        historyRef.current.push({ role: 'assistant', content: assistantText });
      }
      // Keep only last MAX_HISTORY_FOR_CONVO messages
      if (historyRef.current.length > MAX_HISTORY_FOR_CONVO) {
        historyRef.current = historyRef.current.slice(-MAX_HISTORY_FOR_CONVO);
      }
      // Fire onTurn to notify cadence logic that a turn completed
      try { onTurn(); } catch {}
      setTurnsSinceRefresh((n) => (Number.isFinite(n) ? n + 1 : 1));
    } catch {}
  }, [MAX_HISTORY_FOR_CONVO, onTurn]);

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
            await fetchWithRetry('/api/v1/interactions', {
              method: 'POST',
              headers,
              body: JSON.stringify({ sessionId: sid, messageId: `c_user_${now}`, role: 'user', contentHash: djb2(prompt || `c_user_${now}`), text: prompt, ts: now })
            }, { maxAttempts: 3, endpoint: 'interactions' }).catch((error) => {
              try { console.error('[ingest] POST user failed after retries:', error); } catch {}
            });
          })();
          // assistant
          try { console.log('[ingest] POST assistant', { sid, len: reply.length }); } catch {}
          void (async () => {
            const headers = await buildAuthHeaders({ 'content-type': 'application/json', 'x-request-id': reqId });
            await fetchWithRetry('/api/v1/interactions', {
              method: 'POST',
              headers,
              body: JSON.stringify({ sessionId: sid, messageId: `c_assistant_${now+1}`, role: 'assistant', contentHash: djb2(reply || `c_assistant_${now+1}`), text: reply, ts: now + 1 })
            }, { maxAttempts: 3, endpoint: 'interactions' }).catch((error) => {
              try { console.error('[ingest] POST assistant failed after retries:', error); } catch {}
            });
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
            await fetchWithRetry('/api/v1/interactions', {
              method: 'POST',
              headers,
              body: JSON.stringify({ sessionId: sid, messageId: `c_user_stream_${now}`, role: 'user', contentHash: djb2(prompt || `c_user_stream_${now}`), text: prompt, ts: now })
            }, { maxAttempts: 3, endpoint: 'interactions' }).catch((error) => {
              try { console.error('[ingest] POST user streaming failed after retries:', error); } catch {}
            });
          })();
          // assistant
          try { console.log('[ingest] POST assistant streaming', { sid, len: reply.length }); } catch {}
          void (async () => {
            const headers = await buildAuthHeaders({ 'content-type': 'application/json', 'x-request-id': reqId });
            await fetchWithRetry('/api/v1/interactions', {
              method: 'POST',
              headers,
              body: JSON.stringify({ sessionId: sid, messageId: `c_assistant_stream_${now+1}`, role: 'assistant', contentHash: djb2(reply || `c_assistant_stream_${now+1}`), text: reply, ts: now + 1 })
            }, { maxAttempts: 3, endpoint: 'interactions' }).catch((error) => {
              try { console.error('[ingest] POST assistant streaming failed after retries:', error); } catch {}
            });
          })();
        }
      } catch {}
    } catch {}
    return reply;
  }, [chatToTextStreaming, onTurn, sessionId]);

  const getImmediateHistory = useCallback(() => {
    // Try to get from cached interactions first (more comprehensive)
    const recentFromCache = getRecentInteractions(2);
    if (recentFromCache.length > 0) {
      return recentFromCache
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          role: m.role as "user" | "assistant",
          content: m.text
        }));
    }

    // Fallback to in-memory history
    const history = historyRef.current.slice(-2);
    try {
      // getImmediateHistory called
    } catch {}
    return history;
  }, [getRecentInteractions]);

  const getSummaryMeta = useCallback(() => {
    // Use cached summary status if available, fallback to old summary object
    if (summaryStatus) {
      const thresholdTurns = 8; // Default, could be made configurable
      const turnsUntilDue = Math.max(0, thresholdTurns - turnsSince);
      return {
        ready: !!summaryStatus.lastSummary,
        updatedAt: summaryStatus.lastSummary?.updatedAt,
        turnsUntilDue,
        thresholdTurns,
        isDue,
        isInProgress
      };
    }

    // Fallback to old summary object for backward compatibility
    const ready = !!(summary && typeof summary.text === "string" && summary.text.trim().length > 0);
    const thresholdTurns = thresholds?.turns ?? 8;
    const turnsUntilDue = Math.max(0, thresholdTurns - (Number.isFinite(turnsSinceRefresh) ? turnsSinceRefresh : 0));
    return { ready, updatedAt: summary?.updatedAt, turnsUntilDue, thresholdTurns };
  }, [summaryStatus, summary, thresholds?.turns, turnsSinceRefresh, turnsSince, isDue, isInProgress]);

  // Cache management functions
  const refreshInteractionsCache = useCallback(async () => {
    await refreshInteractions();
    try { setLastInteractionsRefreshAt(Date.now()); } catch {}
  }, [refreshInteractions]);

  const refreshSummaryStatusCache = useCallback(async () => {
    await refreshSummaryStatus();
    try { setLastSummaryStatusRefreshAt(Date.now()); } catch {}
  }, [refreshSummaryStatus]);

  const getCacheStatus = useCallback(() => ({
    interactionsCount: interactions.length,
    latestId,
    isLoading: interactionsLoading,
    cacheSize: interactions.length,
    sinceModeActive,
    lastFetchWasIncremental,
    lastFetchWas304,
    lastEtag,
    lastPrefetchAt,
    lastInteractionsRefreshAt,
    lastSummaryStatusRefreshAt,
  }), [
    interactions.length,
    latestId,
    interactionsLoading,
    sinceModeActive,
    lastFetchWasIncremental,
    lastFetchWas304,
    lastEtag,
    lastPrefetchAt,
    lastInteractionsRefreshAt,
    lastSummaryStatusRefreshAt,
  ]);

  // Store refresh functions in ref for trailer event access
  React.useEffect(() => {
    refreshFunctionsRef.current = {
      refreshInteractionsCache,
      refreshSummaryStatus: refreshSummaryStatusCache
    };
  }, [refreshInteractionsCache, refreshSummaryStatusCache]);

  const value = useMemo<MinimalConversationContextValue>(() => ({
    chatToText: chatToTextWithHistory,
    chatToTextStreaming: (prompt: string, onChunk?: (chunk: string) => void, options?: { userProfile?: any; userGoals?: any[]; customSystemPrompt?: string; model?: string; onModelUsed?: (model: string, provider: string) => void; sessionId?: string }) => chatToTextStreaming(prompt, onChunk, options),
    chatToTextStreamingWithHistory,
    getImmediateHistory,
    recordTurn,
    getSummaryMeta,
    getLastPromptPreview: () => promptPreview,
    refreshPromptPreview: async () => {},
    promptPreview,
    // Extended context value with cache management
    refreshInteractionsCache,
    getCacheStatus,
    interactionsCount: interactions.length,
    isInteractionsLoading: interactionsLoading,
    // Summary status cache
    summaryStatus,
    refreshSummaryStatus: refreshSummaryStatusCache,
    isSummaryStatusLoading: summaryStatusLoading,
    isDue,
    isInProgress,
    turnsSince,
    lastSummaryVersion,
    // Interactions cache debug flags
    sinceModeActive,
    lastFetchWasIncremental,
    lastFetchWas304,
    lastEtag,
    // Prefetch and cache freshness telemetry
    lastPrefetchAt,
    lastInteractionsRefreshAt,
    lastSummaryStatusRefreshAt,
  } as MinimalConversationContextValue & {
    refreshInteractionsCache: () => Promise<void>;
    getCacheStatus: () => any;
    interactionsCount: number;
    isInteractionsLoading: boolean;
    summaryStatus: any;
    refreshSummaryStatus: () => Promise<void>;
    isSummaryStatusLoading: boolean;
    isDue: boolean;
    isInProgress: boolean;
    turnsSince: number;
    lastSummaryVersion: number;
    sinceModeActive: boolean;
    lastFetchWasIncremental: boolean;
    lastFetchWas304: boolean;
    lastEtag: string | null;
  }), [
    chatToTextWithHistory,
    chatToTextStreaming,
    chatToTextStreamingWithHistory,
    getImmediateHistory,
    recordTurn,
    getSummaryMeta,
    promptPreview,
    refreshInteractionsCache,
    getCacheStatus,
    interactions.length,
    interactionsLoading,
    summaryStatus,
    refreshSummaryStatusCache,
    summaryStatusLoading,
    isDue,
    isInProgress,
    turnsSince,
    lastSummaryVersion,
    sinceModeActive,
    lastFetchWasIncremental,
    lastFetchWas304,
    lastEtag,
    lastPrefetchAt,
    lastInteractionsRefreshAt,
    lastSummaryStatusRefreshAt,
  ]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}


