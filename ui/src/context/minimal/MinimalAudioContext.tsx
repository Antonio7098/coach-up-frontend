"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

export type MinimalAudioContextValue = {
  enqueueAudio: (url: string) => Promise<void>;
  stop: () => void;
  needsAudioUnlock: boolean;
  unlockAudio: () => Promise<void>;
  pause: () => void;
  resume: () => Promise<void>;
  isPaused: boolean;
};

const Ctx = createContext<MinimalAudioContextValue | undefined>(undefined);

export function useMinimalAudio() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMinimalAudio must be used within MinimalAudioProvider");
  return ctx;
}

export function MinimalAudioProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<Array<{ url: string; resolve: () => void }>>([]);
  const playingRef = useRef(false);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const blockedRef = useRef(false);
  const [isPaused, setIsPaused] = useState(false);
  const pausedRef = useRef(false);

  const attachAndWait = useCallback(async (el: HTMLAudioElement) => {
    await new Promise<void>((resolve) => {
      const cleanup = () => {
        el.removeEventListener("ended", onEnded);
        el.removeEventListener("error", onErr);
      };
      const onEnded = () => { cleanup(); resolve(); };
      const onErr = () => { cleanup(); resolve(); };
      el.addEventListener("ended", onEnded, { once: true });
      el.addEventListener("error", onErr, { once: true });
    });
  }, []);

  const ensureWorker = useCallback(async () => {
    if (playingRef.current) return;
    const next = queueRef.current[0];
    if (!next) return;
    playingRef.current = true;
    try {
      let el = audioRef.current;
      if (!el) {
        el = new Audio();
        audioRef.current = el;
      }
      el.autoplay = true;
      el.src = next.url;
      try {
        await el.play();
        await attachAndWait(el);
      } catch (e: any) {
        if (e && (e.name === "NotAllowedError" || e.code === 0)) {
          blockedRef.current = true;
          setNeedsAudioUnlock(true);
          // Leave playingRef true; unlock will resume and finish the cycle
          return;
        }
        // Other errors: resolve item and continue
      }
    } finally {
      if (!blockedRef.current) {
        playingRef.current = false;
        // Remove item only after a playback run completes
        const item = queueRef.current.shift();
        try { item?.resolve(); } catch {}
        if (queueRef.current.length > 0) void ensureWorker();
      }
    }
  }, []);

  const play = useCallback(async (url: string) => {
    if (!url) return;
    return new Promise<void>((resolve) => {
      queueRef.current.push({ url, resolve });
      void ensureWorker();
    });
  }, [ensureWorker]);

  const stop = useCallback(() => {
    try {
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.currentTime = 0;
        try { el.src = ""; } catch {}
      }
    } catch {}
    // Resolve any pending items so callers don't hang
    try { queueRef.current.forEach((i) => { try { i.resolve(); } catch {} }); } catch {}
    queueRef.current = [];
    playingRef.current = false;
    blockedRef.current = false;
    setNeedsAudioUnlock(false);
    pausedRef.current = false;
    setIsPaused(false);
  }, []);

  const unlockAudio = useCallback(async () => {
    try {
      const el = audioRef.current;
      const next = queueRef.current[0];
      if (!el || !next) { setNeedsAudioUnlock(false); return; }
      // Ensure source is set to the pending item
      if (el.src !== next.url) { el.src = next.url; }
      await el.play();
      blockedRef.current = false;
      setNeedsAudioUnlock(false);
      await attachAndWait(el);
    } catch (e: any) {
      if (e && (e.name === "NotAllowedError" || e.code === 0)) {
        setNeedsAudioUnlock(true);
        return;
      }
    } finally {
      if (!blockedRef.current) {
        playingRef.current = false;
        const item = queueRef.current.shift();
        try { item?.resolve(); } catch {}
        if (queueRef.current.length > 0) void ensureWorker();
      }
    }
  }, [attachAndWait, ensureWorker]);

  const pause = useCallback(() => {
    try {
      const el = audioRef.current;
      if (el && !el.paused) {
        el.pause();
        pausedRef.current = true;
        setIsPaused(true);
      }
    } catch {}
  }, []);

  const resume = useCallback(async () => {
    try {
      const el = audioRef.current;
      if (el && pausedRef.current) {
        await el.play();
        pausedRef.current = false;
        setIsPaused(false);
      }
    } catch {}
  }, []);

  const value = useMemo<MinimalAudioContextValue>(() => ({ enqueueAudio: play, stop, needsAudioUnlock, unlockAudio, pause, resume, isPaused }), [play, stop, needsAudioUnlock, unlockAudio, pause, resume, isPaused]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}


