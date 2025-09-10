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

    // Gate: ensure interactions cache is warm if recent activity within 10 minutes
    const ensureReadyForSend = async (timeoutMs = 700) => {
      try {
        // If we already have cache entries, no need to wait
        if (getRecentInteractions(2).length > 0) return;
        // Ask server for latest interaction timestamp
        const reqId = Math.random().toString(36).slice(2);
        const headers = await buildAuthHeaders({ accept: 'application/json', 'x-request-id': reqId });
        const metaRes = await fetch(`/api/v1/interactions?sessionId=${encodeURIComponent(currentSessionId)}&limit=1`, { method: 'GET', headers, cache: 'no-store' });
        let within10m = false;
        if (metaRes.ok) {
          const meta = await metaRes.json().catch(() => ({} as any));
          const latest = Number(meta?.interactions?.[0]?.createdAt || meta?.interactions?.[0]?.ts || 0);
          if (Number.isFinite(latest) && latest > 0) {
            within10m = (Date.now() - latest) < 10 * 60 * 1000;
          }
        }
        if (!within10m) return; // treat as new session, skip warm-up
        // Trigger a refresh and wait a short time for cache to fill
        try { await refreshInteractionsCache(); } catch {}
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
          if (getRecentInteractions(2).length > 0) return;
          await new Promise(r => setTimeout(r, 50));
        }
      } catch {}
    };

    await ensureReadyForSend(700);

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
    
    // Build history as array to send in POST body (avoid URL limits)
    const historyItems = items;

    const rid = Math.random().toString(36).slice(2);
    lastRidRef.current = rid;
    // Seed a local prompt preview immediately so the debug panel isn't empty while SSE initializes
    try {
      const seeded = {
        system: typeof sys === 'string' ? sys : '',
        summary: undefined as any,
        summaryLen: undefined as any,
        recentMessages: undefined as any,
        prompt: String(prompt || ''),
        createdAt: Date.now(),
      };
      console.log('[POST SSE] seed prompt preview (pre-stream)', { seq, sysLen: (seeded.system || '').length, promptLen: (seeded.prompt || '').length });
      setPromptPreview(seeded);
    } catch {}

    // Increment sequence and close any previous EventSource (latest-wins)
    const seq = ++seqRef.current;
    activeSessionRef.current = currentSessionId || null;
    try { if (esRef.current) { try { esRef.current.close(); } catch {}; esRef.current = null; } } catch {}
    // Start POST-based streaming using fetch + SSE parsing
    const body = {
      prompt,
      sessionId: currentSessionId,
      historyItems,
      userProfile: options?.userProfile || undefined,
      userGoals: options?.userGoals || undefined,
      systemPrompt: options?.customSystemPrompt || undefined,
      model: options?.model || undefined,
      debug: 1,
    };

    const headers: HeadersInit = await buildAuthHeaders({ 'content-type': 'application/json' });

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      throw new Error(`stream failed: ${res.status}`);
    }

    // Fallback: attempt to fetch prompt preview via X-Request-Id if SSE parsing doesn't set it quickly
    const ridHeader = res.headers.get('x-request-id') || res.headers.get('X-Request-Id') || '';
    try { console.log('[POST SSE] response headers', { ridHeader, hadBody: !!res.body }); } catch {}
    let previewSet = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    if (ridHeader) {
      try {
        fallbackTimer = setTimeout(async () => {
          if (previewSet) return;
          try {
            console.log('[POST SSE] fallback timer fired, fetching prompt preview', { rid: ridHeader });
            const r = await fetch(`/api/v1/chat/prompt-preview?rid=${encodeURIComponent(ridHeader)}`, { method: 'GET', headers: await buildAuthHeaders({ accept: 'application/json' }) });
            const j = await r.json().catch(() => ({} as any));
            if (r.ok && j && j.preview && !previewSet) {
              const pp = {
                system: typeof j.preview.system === 'string' ? j.preview.system : '',
                summary: j.preview.summary,
                summaryLen: j.preview.summaryLen,
                recentMessages: j.preview.recentMessages,
                prompt: typeof j.preview.prompt === 'string' ? j.preview.prompt : '',
                createdAt: Date.now(),
              } as any;
              try { console.log('[POST SSE] fallback prompt preview', { rid: ridHeader, sysLen: (pp.system || '').length, promptLen: (pp.prompt || '').length }); } catch {}
              setPromptPreview(pp);
              previewSet = true;
            }
          } catch {}
        }, 250);
      } catch {}
    }

    // SSE parsing
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let acc = '';
    let buffer = '';

    const finish = async () => {
      // finalize this sequence only if it is latest
      if (seq !== seqRef.current) return acc;
      // Notify cadence
      try { onTurn(); } catch {}
      // Cleanup timer if still pending
      if (fallbackTimer) { try { clearTimeout(fallbackTimer); } catch {}; fallbackTimer = null; }
      return acc;
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        await finish();
        return acc;
      }
      buffer += decoder.decode(value, { stream: true });
      // Normalize CRLF to LF for robust SSE parsing
      if (buffer.indexOf('\r\n') !== -1) {
        try { /* debug */ } catch {}
        buffer = buffer.replace(/\r\n/g, '\n');
      }
      // Parse SSE events separated by double newlines
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        // Extract data: lines
        const lines = rawEvent.split('\n');
        const dataLines = lines.filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart());
        if (dataLines.length === 0) continue;
        const data = dataLines.join('\n');
        try { console.log('[POST SSE] data frame', { len: data.length, head: (data || '').slice(0, 120) }); } catch {}
        if (data === '[DONE]') {
          await finish();
          return acc;
        }
        // If server sends a JSON meta event, intercept provider/model used
        try {
          const maybeJson = JSON.parse(data);
          if (maybeJson && typeof maybeJson === 'object') {
            // Handle known metadata and structured chunk formats
            // 1) Prompt event for debug panel
            if (maybeJson.event === 'prompt') {
              try { console.log('[POST SSE] prompt event', { rid: ridHeader, seq, hasRendered: !!maybeJson?.rendered, sysLen: (maybeJson?.system || '').length }); } catch {}
              const pp = {
                system: typeof maybeJson?.system === 'string' ? maybeJson.system : '',
                summary: undefined as any,
                summaryLen: undefined as any,
                recentMessages: undefined as any,
                prompt: typeof maybeJson?.rendered === 'string' ? maybeJson.rendered : (typeof maybeJson?.user === 'string' ? maybeJson.user : ''),
                createdAt: Date.now(),
              };
              try { console.log('[POST SSE] setPromptPreview(event)', { rid: ridHeader, seq, promptLen: (pp.prompt || '').length, sysLen: (pp.system || '').length }); } catch {}
              setPromptPreview(pp);
              previewSet = true;
              if (fallbackTimer) { try { clearTimeout(fallbackTimer); } catch {}; fallbackTimer = null; }
              continue; // do not speak metadata
            }
            // 2) Model/provider metadata (with or without explicit event key)
            if ((maybeJson.event === 'model_used' || maybeJson.model || maybeJson.provider) && typeof options?.onModelUsed === 'function') {
              const mdl = String(maybeJson.model || '');
              const prov = String(maybeJson.provider || '');
              if (mdl) options.onModelUsed(mdl, prov);
              continue; // do not speak metadata
            }
            // 3) Session or other control metadata
            if (maybeJson.sessionId || maybeJson.event || maybeJson.requestId) {
              // Ignore non-text control messages
              continue;
            }
            // 2.5) Prompt preview (from POST /api/chat merged stream)
            if ((typeof maybeJson.rendered === 'string' && maybeJson.rendered.length > 0) || (typeof maybeJson.system === 'string')) {
              try {
                const pp = {
                  system: typeof maybeJson.system === 'string' ? maybeJson.system : '',
                  summary: undefined as any,
                  summaryLen: undefined as any,
                  recentMessages: undefined as any,
                  prompt: String(maybeJson.rendered || maybeJson.user || ''),
                  createdAt: Date.now(),
                };
                try { console.log('[POST SSE] setPromptPreview(meta)', { rid: ridHeader, seq, promptLen: (pp.prompt || '').length, sysLen: (pp.system || '').length }); } catch {}
                setPromptPreview(pp);
                previewSet = true;
                if (fallbackTimer) { try { clearTimeout(fallbackTimer); } catch {}; fallbackTimer = null; }
              } catch {}
              // do not treat as text chunk
              continue;
            }
            // 3) Structured text chunk formats
            if (typeof maybeJson.text === 'string' && maybeJson.text.length > 0) {
              acc += maybeJson.text;
              try { onChunk?.(maybeJson.text); } catch {}
              continue;
            }
            if (maybeJson.delta && typeof maybeJson.delta.content === 'string' && maybeJson.delta.content.length > 0) {
              acc += maybeJson.delta.content;
              try { onChunk?.(maybeJson.delta.content); } catch {}
              continue;
            }
            // Unknown JSON object -> ignore to avoid reading metadata
            continue;
          }
        } catch {}
        // Treat as plain text chunk when not JSON
        if (data && data.trim()) {
          acc += data;
          try { onChunk?.(data); } catch {}
        }
      }
    }
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


