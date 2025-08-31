"use client";

import React from "react";
import { MinimalAudioProvider, useMinimalAudio } from "../../context/minimal/MinimalAudioContext";
import { MinimalVoiceProvider } from "../../context/minimal/MinimalVoiceContext";
import { MinimalConversationProvider, useMinimalConversation } from "../../context/minimal/MinimalConversationContext";
import { useMinimalSession } from "../../context/minimal/MinimalSessionContext";
import { MinimalMicProvider, useMinimalMic } from "../../context/minimal/MinimalMicContext";
import { MinimalSessionProvider } from "../../context/minimal/MinimalSessionContext";

function Content() {
  const mic = useMinimalMic();
  const audio = useMinimalAudio();
  const convo = useMinimalConversation();
  const { sessionId } = useMinimalSession();

  // Fresh panel: independent state that directly calls the API
  const [fresh, setFresh] = React.useState<{ text: string; updatedAt: number; version: number } | null>(null);
  const [freshStatus, setFreshStatus] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [freshErr, setFreshErr] = React.useState<string | undefined>(undefined);
  const refreshFresh = React.useCallback(async () => {
    if (!sessionId) return;
    setFreshStatus("loading");
    setFreshErr(undefined);
    try {
      try { console.log("[fresh] GET start", { sessionId }); } catch {}
      const aiApiBase = (process.env.NEXT_PUBLIC_AI_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
      const reqId = Math.random().toString(36).slice(2);
      // Prefer AI API (LLM-backed) session summary
      const res = await fetch(`${aiApiBase}/api/v1/session-summary?sessionId=${encodeURIComponent(sessionId)}`, {
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
      };
      try { console.log("[fresh] GET ok", { len: next.text.length, version: next.version, updatedAt: next.updatedAt }); } catch {}
      setFresh(next);
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
      try { console.log("[fresh] POST start", { sessionId, prevLen: prev.length, msgs: recentMessages.length }); } catch {}
      const aiApiBase = (process.env.NEXT_PUBLIC_AI_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
      const res = await fetch(`${aiApiBase}/api/v1/session-summary/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, prevSummary: prev, messages: recentMessages, tokenBudget: 600 }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data?.error || `generate failed: ${res.status}`);
      const next = {
        text: String(data?.text || ""),
        updatedAt: typeof data?.updatedAt === 'number' ? data.updatedAt : Date.now(),
        version: typeof data?.version === 'number' ? data.version : (fresh?.version || 1) + 1,
      };
      setFresh(next);
      setFreshStatus("ready");
      try { console.log("[fresh] POST ok", { len: next.text.length, version: next.version }); } catch {}
    } catch {}
  }, [sessionId, fresh?.text, fresh?.version, convo, mic.transcript, mic.assistantText]);
  // v1 cadence: UI-side trigger when due (by turns/seconds), non-blocking
  const lastAutoRef = React.useRef<number>(0);
  const autoInflightRef = React.useRef<boolean>(false);
  const meta = convo.getSummaryMeta();
  React.useEffect(() => {
    if (!sessionId) return;
    const now = Date.now();
    const thresholdSeconds = Number.parseInt(process.env.NEXT_PUBLIC_SUMMARY_REFRESH_SECONDS || "120", 10) || 120;
    const ageSec = meta.updatedAt ? Math.floor((now - meta.updatedAt) / 1000) : Number.MAX_SAFE_INTEGER;
    const due = meta.turnsUntilDue <= 0 || ageSec >= thresholdSeconds;
    const cooldownMs = 5000; // guard against repeated triggers on re-renders
    if (due && !autoInflightRef.current && (now - lastAutoRef.current > cooldownMs)) {
      autoInflightRef.current = true;
      lastAutoRef.current = now;
      try { console.log("[fresh] AUTO generate due", { sessionId, turnsUntilDue: meta.turnsUntilDue, thresholdTurns: meta.thresholdTurns, ageSec, thresholdSeconds }); } catch {}
      void generateFresh().finally(() => { autoInflightRef.current = false; });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, meta.turnsUntilDue, meta.updatedAt]);
  React.useEffect(() => {
    // Auto-start VAD loop on mount
    if (!mic.vadLoop) {
      try { mic.toggleVadLoop(); } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="min-h-screen p-4">
      <h1 className="text-xl font-semibold">Coach (Minimal)</h1>
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
          {/* Removed legacy Summary panel (hook-based) */}
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
          </div>
          <div className="text-xs whitespace-pre-wrap min-h-[64px]">{fresh?.text || <span className="text-zinc-500">(none)</span>}</div>
          {freshErr ? <div className="text-[11px] text-red-600 mt-1">error: {freshErr}</div> : null}
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


