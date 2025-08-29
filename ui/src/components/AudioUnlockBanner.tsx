"use client";

import React from "react";
import { useMic } from "../context/MicContext";

export default function AudioUnlockBanner() {
  const mic = useMic();
  if (!mic?.needsAudioUnlock) return null;

  return (
    <div
      role="region"
      aria-label="Audio playback permission"
      className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3 pointer-events-none"
    >
      <div className="max-w-md mx-auto pointer-events-auto">
        <div className="rounded-2xl border cu-border cu-surface shadow-lg p-3 flex items-start gap-3">
          <div className="mt-0.5">
            <svg aria-hidden viewBox="0 0 24 24" className="w-5 h-5 cu-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 5l6 4v6l-6 4V5z" />
              <path d="M5 8v8" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground">Enable audio</div>
            <div className="text-xs cu-muted mt-0.5">Tap to allow playback so your coach can speak responses.</div>
          </div>
          <div>
            <button
              type="button"
              onClick={() => {
                try { mic.unlockAudio(); } catch {}
              }}
              className="px-3 py-1.5 text-sm font-medium rounded-lg cu-accent-soft-bg border cu-border-surface hover:opacity-90 active:scale-[0.98] transition-all"
              aria-label="Enable audio playback"
            >
              Enable
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
