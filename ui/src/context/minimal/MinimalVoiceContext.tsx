"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { useMinimalAudio } from "./MinimalAudioContext";

export type MinimalVoiceContextValue = {
  enqueueTTSSegment: (text: string) => Promise<void>;
  sttFromBlob: (b: Blob) => Promise<{ text: string }>;
  cancelTTS: () => void;
};

const Ctx = createContext<MinimalVoiceContextValue | undefined>(undefined);

export function useMinimalVoice() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMinimalVoice must be used within MinimalVoiceProvider");
  return ctx;
}

export function MinimalVoiceProvider({ children }: { children: React.ReactNode }) {
  const audio = useMinimalAudio();
  const ttsGenRef = useRef(0);

  const enqueueTTSSegment = useCallback(async (text: string) => {
    if (!text || !text.trim()) return;
    const myGen = ttsGenRef.current;
    // Minimal segmentation by sentence-ending punctuation. Coalesce tiny parts.
    const raw = String(text).replace(/\s+/g, " ").trim();
    const parts = raw
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const MIN_CHARS = 12;
    const segments: string[] = [];
    for (const p of parts) {
      if (!segments.length) { segments.push(p); continue; }
      const last = segments[segments.length - 1];
      if (last.length < MIN_CHARS) segments[segments.length - 1] = `${last} ${p}`.trim();
      else if (p.length < MIN_CHARS) segments[segments.length - 1] = `${last} ${p}`.trim();
      else segments.push(p);
    }
    if (segments.length === 0) segments.push(raw);

    const playPromises: Promise<void>[] = [];
    for (const seg of segments) {
      if (ttsGenRef.current !== myGen) break;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        const res = await fetch("/api/v1/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: seg }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const data: any = await res.json().catch(() => ({}));
        if (!res.ok) continue;
        const url = String(data?.audioUrl || "");
        if (url && ttsGenRef.current === myGen) {
          const p = audio.enqueueAudio?.(url);
          if (p) playPromises.push(p);
        }
      } catch {}
    }
    // Resolve only after all enqueued segments have finished playing
    try { await Promise.all(playPromises); } catch {}
  }, [audio]);

  const sttFromBlob = useCallback(async (b: Blob): Promise<{ text: string }> => {
    const form = new FormData();
    form.set("audio", b, "u.webm");
    const res = await fetch("/api/v1/stt", { method: "POST", body: form });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "stt failed");
    return { text: String(data?.text || "") };
  }, []);

  const cancelTTS = useCallback(() => { ttsGenRef.current++; }, []);

  const value = useMemo<MinimalVoiceContextValue>(() => ({ enqueueTTSSegment, sttFromBlob, cancelTTS }), [enqueueTTSSegment, sttFromBlob, cancelTTS]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}


