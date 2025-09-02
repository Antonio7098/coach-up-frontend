"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { useMinimalAudio } from "./MinimalAudioContext";

export type MinimalVoiceContextValue = {
  enqueueTTSSegment: (text: string) => Promise<void>;
  enqueueTTSChunk: (text: string) => Promise<void>;
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
  const pendingChunksRef = useRef<string[]>([]);
  const isProcessingRef = useRef(false);

  // Text cleaning function to remove asterisks and other unwanted punctuation
  const cleanTextForSpeech = useCallback((text: string): string => {
    return text
      // Remove asterisks used for emphasis
      .replace(/\*/g, '')
      // Remove markdown-style bold/italic markers
      .replace(/\*\*/g, '')
      .replace(/\_\_/g, '')
      .replace(/\`/g, '')
      // Remove excessive punctuation that TTS might mispronounce
      .replace(/\.{3,}/g, '.')  // Replace multiple dots with single dot
      .replace(/\!{2,}/g, '!')  // Replace multiple exclamation marks
      .replace(/\?{2,}/g, '?')  // Replace multiple question marks
      // Clean up extra whitespace
      .replace(/\s+/g, ' ')
      .trim()
  }, []);

  const enqueueTTSSegment = useCallback(async (text: string) => {
    if (!text || !text.trim()) return;
    const myGen = ttsGenRef.current;
    // Clean text before processing
    const cleanedText = cleanTextForSpeech(text);
    // Minimal segmentation by sentence-ending punctuation. Coalesce tiny parts.
    const raw = String(cleanedText).replace(/\s+/g, " ").trim();
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
  }, [audio, cleanTextForSpeech]);

  const processPendingChunks = useCallback(async () => {
    if (isProcessingRef.current || pendingChunksRef.current.length === 0) return;
    isProcessingRef.current = true;

    const myGen = ttsGenRef.current;

    while (pendingChunksRef.current.length > 0 && ttsGenRef.current === myGen) {
      const chunk = pendingChunksRef.current.shift();
      if (!chunk || !chunk.trim()) continue;

      // Clean the chunk before processing
      const cleanedChunk = cleanTextForSpeech(chunk);

      // Split chunk into sentences and process immediately
      const segments = cleanedChunk
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

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
            // Don't wait for this segment to finish - let it play asynchronously
            audio.enqueueAudio?.(url);
          }
        } catch {}
      }
    }

    isProcessingRef.current = false;
  }, [audio, cleanTextForSpeech]);

  const enqueueTTSChunk = useCallback(async (text: string) => {
    if (!text || !text.trim()) return;
    pendingChunksRef.current.push(text);
    void processPendingChunks();
  }, [processPendingChunks]);

  const sttFromBlob = useCallback(async (b: Blob): Promise<{ text: string }> => {
    const form = new FormData();
    form.set("audio", b, "u.webm");
    const res = await fetch("/api/v1/stt", { method: "POST", body: form });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "stt failed");
    return { text: String(data?.text || "") };
  }, []);

  const cancelTTS = useCallback(() => {
    ttsGenRef.current++;
    pendingChunksRef.current = [];
    isProcessingRef.current = false;
  }, []);

  const value = useMemo<MinimalVoiceContextValue>(() => ({
    enqueueTTSSegment,
    enqueueTTSChunk,
    sttFromBlob,
    cancelTTS
  }), [enqueueTTSSegment, enqueueTTSChunk, sttFromBlob, cancelTTS]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}


