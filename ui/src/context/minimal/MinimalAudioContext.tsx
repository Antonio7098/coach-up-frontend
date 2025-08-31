"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef } from "react";

export type MinimalAudioContextValue = {
  enqueueAudio: (url: string) => Promise<void>;
  stop: () => void;
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
      try { await el.play(); } catch {}
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
    } finally {
      playingRef.current = false;
      // Remove item only after a playback run completes
      const item = queueRef.current.shift();
      try { item?.resolve(); } catch {}
      if (queueRef.current.length > 0) void ensureWorker();
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
  }, []);

  const value = useMemo<MinimalAudioContextValue>(() => ({ enqueueAudio: play, stop }), [play, stop]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}


