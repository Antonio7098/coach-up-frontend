"use client";

import React from "react";
import { MinimalAudioProvider, useMinimalAudio } from "../../context/minimal/MinimalAudioContext";
import { MinimalVoiceProvider } from "../../context/minimal/MinimalVoiceContext";
import { MinimalConversationProvider, useMinimalConversation } from "../../context/minimal/MinimalConversationContext";
import { useSessionSummary } from "../../hooks/useSessionSummary";
import { useMinimalSession } from "../../context/minimal/MinimalSessionContext";
import { MinimalMicProvider, useMinimalMic } from "../../context/minimal/MinimalMicContext";
import { MinimalSessionProvider } from "../../context/minimal/MinimalSessionContext";

function Content() {
  const mic = useMinimalMic();
  const audio = useMinimalAudio();
  const convo = useMinimalConversation();
  const { sessionId } = useMinimalSession();
  const { summary, status: summaryStatus, refresh } = useSessionSummary(sessionId, { autoloadOnMount: false });
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
          <div className="p-3 border rounded">
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm font-medium">Summary</div>
              <button type="button" onClick={() => refresh()} className="px-2 py-1 text-xs border rounded">Refresh</button>
            </div>
            <div className="text-[11px] text-zinc-600 mb-2">status={summaryStatus}{summary?.updatedAt ? ` · updated ${new Date(summary.updatedAt).toLocaleTimeString()}` : ""}</div>
            <div className="text-xs whitespace-pre-wrap min-h-[64px]">{summary?.text || <span className="text-zinc-500">(none)</span>}</div>
          </div>
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


