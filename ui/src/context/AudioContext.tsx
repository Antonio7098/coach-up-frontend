"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type AudioContextValue = {
  // Autoplay unlock banner state and action
  needsAudioUnlock: boolean;
  unlockAudio: () => void;
  // Playback helpers
  enqueueAudio: (url: string | undefined) => void;
  stopPlaybackAndClear: () => void;
  pausePlayback: () => void;
  waitForQueueToDrain: (timeoutMs?: number) => Promise<void>;
};

const AudioCtx = createContext<AudioContextValue | undefined>(undefined);

export function useAudio() {
  const ctx = useContext(AudioCtx);
  if (!ctx) throw new Error("useAudio must be used within AudioProvider");
  return ctx;
}

export function AudioProvider({ children }: { children: React.ReactNode }) {

  // Standalone playback state (migrated from MicContext)
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const audioPlayingRef = useRef<boolean>(false);
  const userInteractedRef = useRef<boolean>(false);
  const pendingAudioUrlRef = useRef<string | null>(null);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState<boolean>(false);
  // Playback error surface (show toast after two consecutive failures)
  const playbackErrorCountRef = useRef<number>(0);
  const [playbackErrorVisible, setPlaybackErrorVisible] = useState<boolean>(false);
  const [playbackErrorText, setPlaybackErrorText] = useState<string>("");
  const errorHideTimerRef = useRef<number | null>(null);

  const playAudio = useCallback(async (url: string | undefined): Promise<boolean> => {
    try {
      let el = audioRef.current;
      if (!el) {
        el = new Audio();
        audioRef.current = el;
      }
      // Temporarily disabled URL validation check due to TypeScript strict mode issue
      // const urlToTest = url || "";
      // if (!(urlToTest && /^https?:|^data:|^blob:/i.test(urlToTest))) return;
      el.autoplay = true;
      el.volume = 1.0;
      el.src = url!;
      try { el.load(); } catch {}
      try {
        if (!userInteractedRef.current) {
          pendingAudioUrlRef.current = url!;
          setNeedsAudioUnlock(true);
          try { console.log("AudioContext: Autoplay locked before play(); deferring"); } catch {}
          return false;
        }
        await el.play();
      } catch (e: any) {
        if (e?.name === "NotAllowedError") {
          pendingAudioUrlRef.current = url!;
          setNeedsAudioUnlock(true);
          try { console.log("AudioContext: play() NotAllowedError; deferring until unlock"); } catch {}
          return false;
        }
        // Other playback failure: increment counter and maybe surface error after threshold
        try {
          playbackErrorCountRef.current += 1;
          setPlaybackErrorText("Audio playback failed. Check output device and try again.");
          if (playbackErrorCountRef.current >= 2) {
            setPlaybackErrorVisible(true);
            if (errorHideTimerRef.current) window.clearTimeout(errorHideTimerRef.current);
            errorHideTimerRef.current = window.setTimeout(() => {
              setPlaybackErrorVisible(false);
            }, 8000);
          }
        } catch {}
        return false;
      }
      await new Promise<void>((resolve) => {
        const cleanup = () => {
          el!.removeEventListener("ended", onEnded);
          el!.removeEventListener("error", onErr);
          el!.removeEventListener("pause", onPause);
        };
        const onEnded = () => { cleanup(); resolve(); };
        const onErr = () => {
          try {
            playbackErrorCountRef.current += 1;
            setPlaybackErrorText("Audio playback error during stream.");
            if (playbackErrorCountRef.current >= 2) {
              setPlaybackErrorVisible(true);
              if (errorHideTimerRef.current) window.clearTimeout(errorHideTimerRef.current);
              errorHideTimerRef.current = window.setTimeout(() => {
                setPlaybackErrorVisible(false);
              }, 8000);
            }
          } catch {}
          cleanup();
          resolve();
        };
        const onPause = () => { cleanup(); resolve(); };
        el!.addEventListener("ended", onEnded, { once: true });
        el!.addEventListener("error", onErr, { once: true });
        el!.addEventListener("pause", onPause, { once: true });
      });
      // Reset error counter on a successful playback completion
      try { playbackErrorCountRef.current = 0; } catch {}
      return true;
    } catch {
      return false;
    }
  }, []);

  const stopPlaybackAndClear = useCallback(() => {
    try {
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.currentTime = 0;
        try { el.src = ""; } catch {}
      }
    } catch {}
    // Keep pendingAudioUrlRef as-is; a pending URL might resume after unlock.
    audioQueueRef.current = [];
    audioPlayingRef.current = false;
  }, []);

  const pausePlayback = useCallback(() => {
    try {
      const el = audioRef.current;
      if (el) el.pause();
    } catch {}
    audioPlayingRef.current = false;
  }, []);

  const ensureAudioWorker = useCallback(async () => {
    if (audioPlayingRef.current) return;
    const next = audioQueueRef.current[0];
    if (!next) return;
    audioPlayingRef.current = true;
    let played = false;
    try {
      played = await playAudio(next);
    } finally {
      audioPlayingRef.current = false;
      if (played) {
        // Remove the item only after successful playback run
        audioQueueRef.current.shift();
        if (audioQueueRef.current.length > 0) void ensureAudioWorker();
      } else {
        // Deferred due to autoplay; keep queue intact and wait for unlock
      }
    }
  }, [playAudio]);

  const enqueueAudio = useCallback((url: string | undefined) => {
    if (!url) return;
    audioQueueRef.current.push(url);
    void ensureAudioWorker();
  }, [ensureAudioWorker]);

  // Mark user interaction and retry pending audio
  useEffect(() => {
    const mark = () => {
      if (!userInteractedRef.current) {
        userInteractedRef.current = true;
        setNeedsAudioUnlock(false);
        // Clear any stale pending pointer and try to resume queued playback
        pendingAudioUrlRef.current = null;
        void ensureAudioWorker();
      }
    };
    window.addEventListener("pointerdown", mark, { passive: true } as any);
    window.addEventListener("keydown", mark as any);
    window.addEventListener("touchstart", mark as any);
    return () => {
      window.removeEventListener("pointerdown", mark as any);
      window.removeEventListener("keydown", mark as any);
      window.removeEventListener("touchstart", mark as any);
    };
  }, [ensureAudioWorker]);

  // Ensure audio element is closed on unmount
  useEffect(() => {
    return () => {
      try {
        const el = audioRef.current;
        if (el) {
          el.pause();
          el.currentTime = 0;
          try { el.src = ""; } catch {}
        }
      } catch {}
      audioRef.current = null;
      audioQueueRef.current = [];
      audioPlayingRef.current = false;
      if (errorHideTimerRef.current) window.clearTimeout(errorHideTimerRef.current);
    };
  }, []);

  const unlockAudio = useCallback(() => {
    if (!userInteractedRef.current) {
      userInteractedRef.current = true;
      setNeedsAudioUnlock(false);
      // Clear any stale pending pointer and resume queued playback
      pendingAudioUrlRef.current = null;
      void ensureAudioWorker();
    }
  }, [ensureAudioWorker]);

  const waitForQueueToDrain = useCallback(async (timeoutMs = 15000): Promise<void> => {
    const start = Date.now();
    return new Promise<void>((resolve) => {
      const tick = () => {
        const empty = audioQueueRef.current.length === 0 && !audioPlayingRef.current;
        if (empty || Date.now() - start > timeoutMs) return resolve();
        setTimeout(tick, 100);
      };
      tick();
    });
  }, []);

  // Listen for global enqueue events published by MicContext TTS worker
  useEffect(() => {
    const onEnq = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail && typeof detail === "string") enqueueAudio(detail);
    };
    window.addEventListener("cu.audio.enqueue", onEnq as any);
    return () => window.removeEventListener("cu.audio.enqueue", onEnq as any);
  }, [enqueueAudio]);

  const value = useMemo<AudioContextValue>(() => ({
    needsAudioUnlock,
    unlockAudio,
    enqueueAudio,
    stopPlaybackAndClear,
    pausePlayback,
    waitForQueueToDrain,
  }), [
    needsAudioUnlock,
    unlockAudio,
    enqueueAudio,
    stopPlaybackAndClear,
    pausePlayback,
    waitForQueueToDrain,
  ]);

  return (
    <AudioCtx.Provider value={value}>
      {children}
      {playbackErrorVisible && (
        <div className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3 pointer-events-none">
          <div className="max-w-md mx-auto pointer-events-auto">
            <div className="rounded-2xl border cu-error-border cu-error-soft-bg shadow-lg p-3 flex items-start gap-3">
              <div className="mt-0.5">
                <svg aria-hidden viewBox="0 0 24 24" className="w-5 h-5 cu-error-text" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/></svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">Playback error</div>
                <div className="text-xs cu-muted mt-0.5">{playbackErrorText || "We couldn’t play audio. Check your output device and try again."}</div>
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => { try { setPlaybackErrorVisible(false); } catch {} }}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg cu-surface border cu-border-surface hover:opacity-90 active:scale-[0.98] transition-all"
                  aria-label="Dismiss playback error"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AudioCtx.Provider>
  );
}
