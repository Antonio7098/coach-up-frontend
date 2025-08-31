"use client";

import React from "react";
import { MinimalAudioProvider, useMinimalAudio } from "../../context/minimal/MinimalAudioContext";
import { MinimalVoiceProvider } from "../../context/minimal/MinimalVoiceContext";
import { MinimalConversationProvider } from "../../context/minimal/MinimalConversationContext";
import { MinimalMicProvider, useMinimalMic } from "../../context/minimal/MinimalMicContext";

function Content() {
  const mic = useMinimalMic();
  const audio = useMinimalAudio();
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
      <div className="mt-4 space-y-3 max-w-md">
        <div className="text-sm"><span className="font-medium">You:</span> {mic.transcript || <span className="text-zinc-500">(none)</span>}</div>
        <div className="text-sm"><span className="font-medium">Assistant:</span> {mic.assistantText || <span className="text-zinc-500">(none)</span>}</div>
        <div className="text-xs text-zinc-600">status={mic.status} · loop={String(mic.vadLoop)} · recording={String(mic.recording)}</div>
        <div className="flex gap-2">
          {(() => {
            const isAnyLoop = mic.vadLoop;
            return (
              <>
                <button type="button" onClick={() => mic.startRecording()} disabled={isAnyLoop} className={`px-3 py-1.5 rounded border ${isAnyLoop ? 'opacity-50 cursor-not-allowed' : ''}`}>Tap to speak</button>
                <button type="button" onClick={() => mic.stopRecording()} disabled={isAnyLoop} className={`px-3 py-1.5 rounded border ${isAnyLoop ? 'opacity-50 cursor-not-allowed' : ''}`}>Stop</button>
                <button type="button" onClick={() => mic.toggleVadLoop()} className={`px-3 py-1.5 rounded border`}>Loop (VAD): {mic.vadLoop ? 'On' : 'Off'}</button>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

export default function CoachMinimalPage() {
  return (
    <MinimalAudioProvider>
      <MinimalVoiceProvider>
        <MinimalConversationProvider>
          <MinimalMicProvider>
            <Content />
          </MinimalMicProvider>
        </MinimalConversationProvider>
      </MinimalVoiceProvider>
    </MinimalAudioProvider>
  );
}


