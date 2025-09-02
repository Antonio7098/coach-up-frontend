"use client";

import React from "react";
import { MinimalAudioProvider, useMinimalAudio } from "../../context/minimal/MinimalAudioContext";
import { MinimalVoiceProvider } from "../../context/minimal/MinimalVoiceContext";
import { MinimalConversationProvider, useMinimalConversation } from "../../context/minimal/MinimalConversationContext";
import { useMinimalSession } from "../../context/minimal/MinimalSessionContext";
import { MinimalMicProvider, useMinimalMic } from "../../context/minimal/MinimalMicContext";
import { MinimalSessionProvider } from "../../context/minimal/MinimalSessionContext";
import { useUser } from "@clerk/nextjs";

function Content() {
  const mic = useMinimalMic();
  const audio = useMinimalAudio();
  const convo = useMinimalConversation();
  const { sessionId } = useMinimalSession();

  // Fresh panel: independent state that directly calls the API
  const [fresh, setFresh] = React.useState<{ text: string; updatedAt: number; version: number; lastMessageTs?: number; thresholdTurns?: number; turnsSince?: number } | null>(null);
  const [freshStatus, setFreshStatus] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [freshErr, setFreshErr] = React.useState<string | undefined>(undefined);
  const [dbgOpen, setDbgOpen] = React.useState<boolean>(false);
  const [ingestTestStatus, setIngestTestStatus] = React.useState<string>("");
  const [dbgPrompt, setDbgPrompt] = React.useState<{ prevSummary: string; messages: Array<{ role: 'user'|'assistant'; content: string }> } | null>(null);
  const [promptPreview, setPromptPreview] = React.useState<any>(null);
  // Keep the latest prompt preview from SSE in sync automatically
  const lastSsePreview = convo.promptPreview;
  React.useEffect(() => {
    if (lastSsePreview && typeof lastSsePreview?.prompt === 'string' && lastSsePreview.prompt.trim().length > 0) {
      setPromptPreview(lastSsePreview);
    }
  }, [lastSsePreview]);
  // Local in-session history of summaries (ascending by version)
  const [history, setHistory] = React.useState<Array<{ version: number; updatedAt: number; text: string }>>([]);
  const [openMap, setOpenMap] = React.useState<Record<number, boolean>>({});
  // Local delta since last server cadence fetch
  const [sinceFetchDelta, setSinceFetchDelta] = React.useState<number>(0);
  // Server transcript (Convex-backed)
  const [serverTranscript, setServerTranscript] = React.useState<Array<{ id: string; role: 'user'|'assistant'|'system'|string; text: string; createdAt: number }>>([]);
  const [serverTranscriptStatus, setServerTranscriptStatus] = React.useState<"idle"|"loading"|"ready"|"error">("idle");
  const [serverTranscriptErr, setServerTranscriptErr] = React.useState<string | undefined>(undefined);
  const refreshServerTranscript = React.useCallback(async () => {
    if (!sessionId) return;
    setServerTranscriptStatus("loading");
    setServerTranscriptErr(undefined);
    try {
      const reqId = Math.random().toString(36).slice(2);
      const res = await fetch(`/api/v1/transcripts?sessionId=${encodeURIComponent(sessionId)}&limit=200`, {
        method: 'GET',
        headers: { accept: 'application/json', 'x-request-id': reqId },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data?.error || `transcripts failed: ${res.status}`);
      const items = Array.isArray(data?.items) ? data.items : [];
      const mapped = items.map((it: any) => ({ id: String(it.id || ''), role: String(it.role || ''), text: String(it.text || ''), createdAt: Number(it.createdAt || Date.now()) }));
      setServerTranscript(mapped);
      setServerTranscriptStatus('ready');
    } catch (e) {
      setServerTranscriptErr(e instanceof Error ? e.message : String(e));
      setServerTranscriptStatus('error');
    }
  }, [sessionId]);
  // Session state (Convex-backed)
  const [sessionState, setSessionState] = React.useState<any>(null);
  const [sessionStateStatus, setSessionStateStatus] = React.useState<"idle"|"loading"|"ready"|"error">("idle");
  const [sessionStateErr, setSessionStateErr] = React.useState<string | undefined>(undefined);
  const refreshSessionState = React.useCallback(async () => {
    if (!sessionId) return;
    setSessionStateStatus('loading');
    setSessionStateErr(undefined);
    try {
      const reqId = Math.random().toString(36).slice(2);
      const res = await fetch(`/api/v1/sessions?sessionId=${encodeURIComponent(sessionId)}`, {
        method: 'GET',
        headers: { accept: 'application/json', 'x-request-id': reqId },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data?.error || `sessions failed: ${res.status}`);
      setSessionState(data?.session ?? null);
      setSessionStateStatus('ready');
    } catch (e) {
      setSessionStateErr(e instanceof Error ? e.message : String(e));
      setSessionStateStatus('error');
    }
  }, [sessionId]);
  // Track assistant-completed turns since last summary refresh to display turns-until-due
  const [turnsSince, setTurnsSince] = React.useState<number>(0);
  // Server-driven cadence values (fallbacks remain for local-only)
  const thresholdTurns = Number.isFinite(Number(fresh?.['thresholdTurns'])) ? Number((fresh as any)['thresholdTurns']) : (Number.parseInt(process.env.NEXT_PUBLIC_SUMMARY_REFRESH_TURNS || "8", 10) || 8);
  const refreshFresh = React.useCallback(async () => {
    if (!sessionId) return;
    setFreshStatus("loading");
    setFreshErr(undefined);
    try {
      try { console.log("[fresh] GET start", { sessionId }); } catch {}
      const reqId = Math.random().toString(36).slice(2);
      // Prefer UI API (Convex-backed) session summary
      const res = await fetch(`/api/v1/session-summary?sessionId=${encodeURIComponent(sessionId)}`, {
        method: "GET",
        headers: { accept: "application/json", "x-request-id": reqId },
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `fetch failed: ${res.status}`);
      const next = {
        text: String((data?.text ?? data?.summaryText) || ""),
        updatedAt: typeof data?.updatedAt === "number" ? data.updatedAt : Date.now(),
        version: typeof data?.version === "number" ? data.version : 1,
        lastMessageTs: typeof data?.lastMessageTs === 'number' ? data.lastMessageTs : undefined,
        thresholdTurns: typeof data?.thresholdTurns === 'number' ? data.thresholdTurns : undefined,
        turnsSince: typeof data?.turnsSince === 'number' ? data.turnsSince : undefined,
      };
      try { console.log("[fresh] GET ok", { len: next.text.length, version: next.version, updatedAt: next.updatedAt }); } catch {}
      setFresh(next);
      setSinceFetchDelta(0);
      setHistory((cur) => {
        const exists = cur.some((h) => h.version === next.version);
        const arr = exists ? cur : [...cur, { version: next.version, updatedAt: next.updatedAt, text: next.text }];
        arr.sort((a,b) => a.version - b.version);
        return arr;
      });
      setFreshStatus("ready");
    } catch (e) {
      try { console.log("[fresh] GET error", { err: e instanceof Error ? e.message : String(e) }); } catch {}
      setFreshErr(e instanceof Error ? e.message : String(e));
      setFreshStatus("error");
    }
  }, [sessionId]);
  const generateFresh = React.useCallback(async () => {
    if (!sessionId) return;
    try {
      const prev = fresh?.text || "";
      let recentMessages = convo.getImmediateHistory();
      if (!recentMessages || recentMessages.length === 0) {
        const fallback: Array<{ role: 'user'|'assistant'; content: string }> = [];
        if (mic.transcript && mic.transcript.trim()) fallback.push({ role: 'user', content: mic.transcript });
        if (mic.assistantText && mic.assistantText.trim()) fallback.push({ role: 'assistant', content: mic.assistantText });
        if (fallback.length > 0) recentMessages = fallback;
      }
      // If still no messages, skip generation
      if (!recentMessages || recentMessages.length === 0) return;
      // Save debug prompt details for the panel
      try { setDbgPrompt({ prevSummary: prev, messages: recentMessages }); } catch {}
      try { console.log("[fresh] POST start", { sessionId, prevLen: prev.length, msgs: recentMessages.length }); } catch {}
      const res = await fetch(`/api/v1/session-summary`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, prevSummary: prev, messages: recentMessages, tokenBudget: 600 }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data?.error || `generate failed: ${res.status}`);
      // After ack, refresh to fetch latest text/version and transcript for diff
      await Promise.all([
        refreshFresh(),
        refreshServerTranscript(),
      ]);
      setFreshStatus("ready");
      try { console.log("[fresh] POST ok (ack)"); } catch {}
    } catch {}
  }, [sessionId, fresh?.text, fresh?.version, convo, mic.transcript, mic.assistantText]);
  // Server cadence: remove UI auto trigger; rely on backend via persisted interactions
  const lastAutoRef = React.useRef<number>(0);
  const autoInflightRef = React.useRef<boolean>(false);
  const meta = convo.getSummaryMeta();
  // Remove UI auto cadence effect
  React.useEffect(() => {
    // Auto-start VAD loop on mount
    if (!mic.vadLoop) {
      try { mic.toggleVadLoop(); } catch {}
    }
    // Prime server panels on mount
    void refreshServerTranscript();
    void refreshSessionState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // When assistant produces a new reply, schedule a short delayed refresh to pick up
  // backend cadence-generated summaries (non-blocking and debounced)
  const lastAssistantRef = React.useRef<string | null>(null);
  const refreshInflightRef = React.useRef<boolean>(false);
  React.useEffect(() => {
    const cur = mic.assistantText || "";
    const prev = lastAssistantRef.current || "";
    if (cur && cur !== prev && !refreshInflightRef.current) {
      // Count a completed assistant turn
      setTurnsSince((n) => (Number.isFinite(n) ? n + 1 : 1));
      setSinceFetchDelta((d) => (Number.isFinite(d) ? d + 1 : 1));
      refreshInflightRef.current = true;
      lastAssistantRef.current = cur;
      setTimeout(() => {
        void Promise.all([
          refreshFresh(),
          refreshServerTranscript(),
          refreshSessionState(),
        ]).finally(() => { refreshInflightRef.current = false; });
      }, 1200);
    }
  }, [mic.assistantText, refreshFresh]);
  // Reset turn counter when a new summary arrives
  React.useEffect(() => {
    if (fresh?.updatedAt) setTurnsSince(0);
  }, [fresh?.updatedAt]);
  return (
    <div className="min-h-screen p-4">
      <h1 className="text-xl font-semibold">Coach (Debug)</h1>
      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="text-blue-800 font-medium">🔧 Debug Mode</div>
        <div className="text-sm text-blue-600">This is a debug version of the coach interface with additional debugging features.</div>
      </div>
      {audio.needsAudioUnlock ? (
        <div className="mb-3 p-2 rounded border bg-yellow-50 text-yellow-900 text-sm flex items-center justify-between">
          <span>Audio is blocked by the browser. Click to enable sound.</span>
          <button type="button" onClick={() => audio.unlockAudio()} className="ml-3 px-2 py-1 rounded border">Enable sound</button>
        </div>
      ) : null}
      <div className="mt-4 space-y-3 max-w-2xl">
        <div className="text-sm"><span className="font-medium">You:</span> {mic.transcript || <span className="text-zinc-500">(none)</span>}</div>
        <div className="text-sm"><span className="font-medium">Assistant:</span> {mic.assistantText || <span className="text-zinc-500">(none)</span>}</div>
        <div className="text-xs text-zinc-600">status={mic.status} · loop={String(mic.vadLoop)} · recording={String(mic.recording)} · playing={String(audio.isPlaybackActive)}</div>
        <div className="flex gap-2">
          {(() => {
            const isAnyLoop = mic.vadLoop;
            return (
              <>
                <button type="button" onClick={() => mic.startRecording()} disabled={isAnyLoop} className={`px-3 py-1.5 rounded border ${isAnyLoop ? 'opacity-50 cursor-not-allowed' : ''}`}>Tap to speak</button>
                <button type="button" onClick={() => mic.stopRecording()} disabled={isAnyLoop} className={`px-3 py-1.5 rounded border ${isAnyLoop ? 'opacity-50 cursor-not-allowed' : ''}`}>Stop</button>
                <button type="button" onClick={() => mic.toggleVadLoop()} className={`px-3 py-1.5 rounded border`}>Loop (VAD): {mic.vadLoop ? 'On' : 'Off'}</button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!sessionId) { setIngestTestStatus('no sessionId'); return; }
                    try {
                      const now = Date.now();
                      const reqId = Math.random().toString(36).slice(2);
                      const body = { sessionId, messageId: `test_${now}`, role: 'user', contentHash: 'test', text: 'ping', ts: now };
                      const res = await fetch('/api/v1/interactions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': reqId }, body: JSON.stringify(body) });
                      const data = await res.json().catch(() => ({} as any));
                      setIngestTestStatus(res.ok ? `ok id=${String(data?.id || '')}` : `err ${res.status}: ${String(data?.error || '')}`);
                    } catch (e) { setIngestTestStatus(e instanceof Error ? e.message : String(e)); }
                  }}
                  className={`px-3 py-1.5 rounded border`}
                >Test ingest</button>
                <button type="button" onClick={() => (audio.isPaused ? audio.resume() : audio.pause())} className={`px-3 py-1.5 rounded border`}>{audio.isPaused ? 'Resume' : 'Pause'} playback</button>
              </>
            );
          })()}
        </div>
        {/* History Panel */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-3 border rounded">
            <div className="text-sm font-medium mb-1">Recent messages</div>
            <div className="text-xs space-y-1">
              {convo.getImmediateHistory().length === 0 ? (
                <div className="text-zinc-500">(empty)</div>
              ) : (
                convo.getImmediateHistory().map((m, i) => (
                  <div key={i}><span className="font-medium">{m.role}:</span> {m.content}</div>
                ))
              )}
            </div>
          </div>
          {/* Server Transcript Panel */}
          <div className="p-3 border rounded">
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm font-medium">Server transcript</div>
              <div className="flex gap-2">
                <button type="button" onClick={refreshServerTranscript} className="px-2 py-1 text-xs border rounded">Refresh</button>
              </div>
            </div>
            <div className="text-[11px] text-zinc-600 mb-1">status={serverTranscriptStatus}</div>
            <div className="text-xs space-y-1 max-h-56 overflow-auto">
              {serverTranscript.length === 0 ? (
                <div className="text-zinc-500">(empty)</div>
              ) : (
                serverTranscript.map((m) => (
                  <div key={m.id}><span className="font-medium">{m.role}:</span> {m.text || <span className="text-zinc-500">(no text)</span>}</div>
                ))
              )}
            </div>
            {serverTranscriptErr ? <div className="text-[11px] text-red-600 mt-1">error: {serverTranscriptErr}</div> : null}
          </div>
        </div>
        {/* LLM Prompt (debug) Panel */}
        <div className="p-3 border rounded mt-2">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-medium">LLM Prompt (debug)</div>
            <div className="flex gap-2">
              <button type="button" onClick={() => { try { setPromptPreview(convo.getLastPromptPreview()); } catch {} }} className="px-2 py-1 text-xs border rounded">Refresh</button>
            </div>
          </div>
          <div className="text-[11px] text-zinc-600 mb-1">{promptPreview ? 'ready' : 'empty'}</div>
          {promptPreview ? (
            <div className="text-[11px] space-y-1">
              <div className="font-medium">full prompt sent to LLM:</div>
              <pre className="whitespace-pre-wrap bg-zinc-50 p-2 border rounded max-h-56 overflow-auto">{promptPreview.prompt || ''}</pre>
            </div>
          ) : (
            <div className="text-[11px] text-zinc-500">(none)</div>
          )}
        </div>
        {/* Fresh Summary Panel (independent) */}
        <div className="mt-4 p-3 border rounded">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-medium">Summary (fresh)</div>
            <div className="flex gap-2">
              <button type="button" onClick={refreshFresh} className="px-2 py-1 text-xs border rounded">Refresh</button>
              <button type="button" onClick={generateFresh} className="px-2 py-1 text-xs border rounded">Generate</button>
            </div>
          </div>
          <div className="text-[11px] text-zinc-600 mb-2">
            status={freshStatus}
            {fresh?.updatedAt ? ` · updated ${new Date(fresh.updatedAt).toLocaleTimeString()}` : ""}
            {fresh ? ` · v${fresh.version}` : ""}
            {(() => {
              const serverTurnsSince = Number.isFinite(Number((fresh as any)?.turnsSince)) ? Number((fresh as any)?.turnsSince) : undefined;
              const effectiveSince = serverTurnsSince !== undefined
                ? Math.max(0, serverTurnsSince + (Number.isFinite(sinceFetchDelta) ? sinceFetchDelta : 0))
                : (Number.isFinite(turnsSince) ? turnsSince : 0);
              const suffix = serverTurnsSince !== undefined ? '' : ' (local)';
              return ` · turns until due: ${Math.max(0, thresholdTurns - effectiveSince)}${suffix}`;
            })()}
          </div>
          <div className="text-xs whitespace-pre-wrap min-h-[64px]">{fresh?.text || <span className="text-zinc-500">(none)</span>}</div>
          {/* Incorporated messages since last cutoff */}
          <div className="mt-2">
            <div className="text-[11px] text-zinc-700 font-medium mb-1">Messages incorporated since last cutoff</div>
            <div className="text-[11px] bg-zinc-50 p-2 border rounded max-h-40 overflow-auto">
              {(() => {
                const cutoff = fresh?.lastMessageTs || 0;
                const msgs = serverTranscript
                  .filter(m => (m.createdAt ?? 0) > cutoff)
                  .map(m => `${m.role}: ${m.text}`);
                if (!fresh || cutoff === 0 || msgs.length === 0) return <span className="text-zinc-500">(none)</span>;
                return <div className="space-y-1">{msgs.map((t, i) => (<div key={i}>{t}</div>))}</div>;
              })()}
            </div>
          </div>
          {freshErr ? <div className="text-[11px] text-red-600 mt-1">error: {freshErr}</div> : null}
          {/* Debug prompt details */}
          <div className="mt-2">
            <button type="button" onClick={() => setDbgOpen(o => !o)} className="px-2 py-1 text-[10px] border rounded">{dbgOpen ? 'Hide' : 'Show'} LLM prompt debug</button>
            {dbgOpen && (
              <div className="mt-2 text-[10px] text-zinc-700 space-y-1">
                <div className="font-medium">Prev summary (preview):</div>
                <div className="whitespace-pre-wrap bg-zinc-50 p-2 border rounded">{dbgPrompt?.prevSummary ? (dbgPrompt.prevSummary.length > 300 ? dbgPrompt.prevSummary.slice(0,300) + '…' : dbgPrompt.prevSummary) : '(none)'}</div>
                <div className="font-medium mt-2">Recent messages ({dbgPrompt?.messages?.length ?? 0}):</div>
                <div className="space-y-1">
                  {(dbgPrompt?.messages || []).slice(0, 6).map((m, i) => (
                    <div key={i} className="bg-zinc-50 p-2 border rounded">
                      <span className="font-medium">{m.role}:</span> {m.content.length > 120 ? m.content.slice(0,120) + '…' : m.content}
                    </div>
                  ))}
                  {(dbgPrompt?.messages || []).length > 6 ? <div className="text-zinc-500">…and more</div> : null}
                </div>
              </div>
            )}
          </div>
        </div>
        {/* Local Summary History (expandable) */}
        <div className="mt-3 p-3 border rounded">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">Summary history (local)</div>
            <div className="text-[11px] text-zinc-600">{history.length} versions</div>
          </div>
          {history.length === 0 ? (
            <div className="text-[11px] text-zinc-500">(empty)</div>
          ) : (
            <div className="space-y-2">
              {history.map((h) => (
                <div key={h.version} className="border rounded">
                  <div className="flex items-center justify-between px-2 py-1 bg-zinc-50">
                    <div className="text-[11px] text-zinc-700">v{h.version} · {new Date(h.updatedAt).toLocaleTimeString()}</div>
                    <button type="button" className="text-[10px] px-2 py-0.5 border rounded" onClick={() => setOpenMap((m) => ({ ...m, [h.version]: !m[h.version] }))}>{openMap[h.version] ? 'Hide' : 'Show'}</button>
                  </div>
                  {openMap[h.version] ? (
                    <div className="p-2 text-[12px] whitespace-pre-wrap">{h.text}</div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Session State Panel */}
        <div className="mt-3 p-3 border rounded">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">Session state</div>
            <div className="flex gap-2">
              <button type="button" onClick={refreshSessionState} className="px-2 py-1 text-xs border rounded">Refresh</button>
            </div>
          </div>
          <div className="text-[11px] text-zinc-600 mb-1">status={sessionStateStatus}</div>
          <pre className="text-[11px] whitespace-pre-wrap bg-zinc-50 p-2 rounded border overflow-x-auto">{JSON.stringify(sessionState ?? null, null, 2)}</pre>
          {sessionStateErr ? <div className="text-[11px] text-red-600 mt-1">error: {sessionStateErr}</div> : null}
          {ingestTestStatus ? <div className="text-[11px] mt-1">ingest: {ingestTestStatus}</div> : null}
        </div>
      </div>
    </div>
  );
}

export default function CoachMinimalPage() {
  return (
    <MinimalAudioProvider>
      <MinimalSessionProvider>
        <MinimalVoiceProvider>
          <MinimalConversationProvider>
            <MinimalMicProvider>
              <Content />
            </MinimalMicProvider>
          </MinimalConversationProvider>
        </MinimalVoiceProvider>
      </MinimalSessionProvider>
    </MinimalAudioProvider>
  );
}


