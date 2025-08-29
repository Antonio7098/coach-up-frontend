"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type AudioContextValue = {
  // Autoplay unlock banner state and action
  needsAudioUnlock: boolean;
  unlockAudio: () => void;
  // Playback helpers
  enqueueAudio: (url: string) => void;
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

  const playAudio = useCallback(async (url: string) => {
    try {
      let el = audioRef.current;
      if (!el) {
        el = new Audio();
        audioRef.current = el;
      }
      if (!/^https?:|^data:|^blob:/i.test(url)) return;
      el.autoplay = true;
      el.volume = 1.0;
      el.src = url;
      try { el.load(); } catch {}
      try {
        if (!userInteractedRef.current) {
          pendingAudioUrlRef.current = url;
          setNeedsAudioUnlock(true);
          return;
        }
        await el.play();
      } catch (e: any) {
        if (e?.name === "NotAllowedError") {
          pendingAudioUrlRef.current = url;
          setNeedsAudioUnlock(true);
          return;
        }
        return;
      }
      await new Promise<void>((resolve) => {
        const cleanup = () => {
          el!.removeEventListener("ended", onEnded);
          el!.removeEventListener("error", onErr);
          el!.removeEventListener("pause", onPause);
        };
        const onEnded = () => { cleanup(); resolve(); };
        const onErr = () => { cleanup(); resolve(); };
        const onPause = () => { cleanup(); resolve(); };
        el!.addEventListener("ended", onEnded, { once: true });
        el!.addEventListener("error", onErr, { once: true });
        el!.addEventListener("pause", onPause, { once: true });
      });
    } catch {}
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
    pendingAudioUrlRef.current = null;
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
    const next = audioQueueRef.current.shift();
    if (!next) return;
    audioPlayingRef.current = true;
    try {
      await playAudio(next);
    } finally {
      audioPlayingRef.current = false;
      if (audioQueueRef.current.length > 0) void ensureAudioWorker();
    }
  }, [playAudio]);

  const enqueueAudio = useCallback((url: string) => {
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
        const url = pendingAudioUrlRef.current;
        if (url) {
          pendingAudioUrlRef.current = null;
          enqueueAudio(url);
        }
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
  }, [enqueueAudio]);

  const unlockAudio = useCallback(() => {
    if (!userInteractedRef.current) {
      userInteractedRef.current = true;
      setNeedsAudioUnlock(false);
      const url = pendingAudioUrlRef.current;
      if (url) {
        pendingAudioUrlRef.current = null;
        enqueueAudio(url);
      }
    }
  }, [enqueueAudio]);

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
      if (typeof detail === "string" && detail) enqueueAudio(detail);
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

  return <AudioCtx.Provider value={value}>{children}</AudioCtx.Provider>;
}
