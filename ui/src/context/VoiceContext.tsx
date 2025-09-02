"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "./ChatContext";

export type VoiceContextValue = {
  // Pipeline busy state and thinking ring
  busy: "idle" | "stt" | "chat" | "tts";
  processingRing: boolean;
  // Latest text artifacts
  transcript: string;
  assistantText: string;
  // Error surface
  voiceError: string;
  // Minimal TTS enqueue adapter during migration
  enqueueTTSSegment: (text: string) => void;
  // Cancel TTS worker and clear queued segments
  cancelTTS: () => void;
  // STT adapter during migration
  sttFromBlob: (b: Blob, detectMs?: number) => Promise<{ text: string }>;
};

const VoiceCtx = createContext<VoiceContextValue | undefined>(undefined);

// Module-level adapters and pub/sub so other modules (e.g., MicContext) can publish state
type VoiceState = Pick<VoiceContextValue, "busy" | "processingRing" | "transcript" | "assistantText" | "voiceError">;
let currentState: VoiceState = {
  busy: "idle",
  processingRing: false,
  transcript: "",
  assistantText: "",
  voiceError: "",
};
let subscribers = new Set<(s: VoiceState) => void>();
let adapters: Pick<VoiceContextValue, "enqueueTTSSegment" | "sttFromBlob"> = {
  enqueueTTSSegment: () => {},
  sttFromBlob: async () => ({ text: "" }),
};

export function voicePublishState(partial: Partial<VoiceState>) {
  currentState = { ...currentState, ...partial };
  subscribers.forEach((fn) => fn(currentState));
}

export function voiceSetAdapters(next: typeof adapters) {
  adapters = next;
}

export function useVoice() {
  const ctx = useContext(VoiceCtx);
  if (!ctx) throw new Error("useVoice must be used within VoiceProvider");
  return ctx;
}

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<VoiceState>(currentState);
  const { sessionId } = useChat();

  // --- Local refs for TTS worker ---
  const ttsTextQueueRef = useRef<string[]>([]);
  const ttsProcessingRef = useRef(false);
  const ttsCancelRef = useRef(0);

  // Timeouts
  const TTS_TIMEOUT_MS = (Number(process.env.NEXT_PUBLIC_TTS_TIMEOUT_MS ?? 0) || 15000);
  const STT_TIMEOUT_MS = (Number(process.env.NEXT_PUBLIC_STT_TIMEOUT_MS ?? 0) || 12000);
  // STT direct upload controls
  const STT_DIRECT_UPLOAD_ENABLED = useMemo(() => {
    const v = String(process.env.NEXT_PUBLIC_STT_DIRECT_UPLOAD_ENABLED || "").toLowerCase();
    if (v === "0" || v === "false") return false;
    if (v === "1" || v === "true") return true;
    return true;
  }, []);
  const STT_DIRECT_UPLOAD_THRESHOLD_BYTES = useMemo(() => {
    const n = Number(process.env.NEXT_PUBLIC_STT_DIRECT_UPLOAD_THRESHOLD_BYTES ?? 0);
    return (isFinite(n) && n > 0) ? Math.floor(n) : 512 * 1024;
  }, []);

  useEffect(() => {
    subscribers.add(setState);
    setState(currentState);
    return () => {
      subscribers.delete(setState);
    };
  }, []);

  // --- TTS helpers (built-in) ---
  const callTTSChunk = useCallback(async (text: string): Promise<string> => {
    try {
      console.log("VoiceContext: TTS chunk processing started", {
        text: text || "(empty)",
        textLength: (text || "").length,
        sessionId: sessionId || "none"
      });
      const doOnce = async (): Promise<Response> => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
        try {
          const res = await fetch("/api/v1/tts", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-request-id": Math.random().toString(36).slice(2),
            },
            body: JSON.stringify({ text, sessionId: sessionId || undefined }),
            signal: controller.signal,
          });
          return res;
        } finally {
          clearTimeout(timeoutId);
        }
      };
      let res: Response | null = null;
      let timedOut = false;
      try { res = await doOnce(); } catch (e: any) { if (e?.name === 'AbortError') timedOut = true; else throw e; }
      if (!res && timedOut) {
        try { res = await doOnce(); } catch {}
      }
      if (!res) {
        console.log("VoiceContext: TTS request failed - no response");
        return "";
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.log("VoiceContext: TTS request failed", {
          status: res.status,
          error: data?.error,
          textLength: (text || "").length
        });
        throw new Error(data?.error || `tts failed: ${res.status}`);
      }

      const audioUrl = String(data?.audioUrl || "");
      console.log("VoiceContext: TTS response received", {
        audioUrl: audioUrl || "(empty)",
        textLength: (text || "").length,
        hasAudio: !!audioUrl
      });
      return audioUrl;
    } catch {
      return "";
    }
  }, [sessionId, TTS_TIMEOUT_MS]);

  const ensureTTSWorker = useCallback(async () => {
    if (ttsProcessingRef.current) return;
    ttsProcessingRef.current = true;
    const myGen = ttsCancelRef.current;
    try {
      while (ttsTextQueueRef.current.length > 0) {
        if (ttsCancelRef.current !== myGen) break;
        // Backpressure: coalesce tiny segments and enforce a max queue size
        const MAX_QUEUE = 8;
        const MIN_SEG_CHARS = 12;
        // Enforce cap by merging extras into the last element
        if (ttsTextQueueRef.current.length > MAX_QUEUE) {
          const overflow = ttsTextQueueRef.current.splice(MAX_QUEUE);
          if (overflow.length > 0) {
            const mergedTail = overflow.join(" ").trim();
            if (mergedTail) ttsTextQueueRef.current[ttsTextQueueRef.current.length - 1] = `${ttsTextQueueRef.current[ttsTextQueueRef.current.length - 1]} ${mergedTail}`.trim();
          }
        }
        let next = ttsTextQueueRef.current.shift()!;
        // Merge successive tiny segments to avoid machine-gun TTS
        while (next.length < MIN_SEG_CHARS && ttsTextQueueRef.current.length > 0) {
          const peek = ttsTextQueueRef.current[0];
          if (!peek) break;
          next = `${next} ${peek}`.trim();
          ttsTextQueueRef.current.shift();
          if (next.length >= MIN_SEG_CHARS) break;
        }
        const text = next;
        console.log("VoiceContext: TTS worker processing chunk", {
          text: text || "(empty)",
          textLength: (text || "").length,
          queueRemaining: ttsTextQueueRef.current.length,
          generation: myGen,
          currentCancelGen: ttsCancelRef.current
        });

        const url = await callTTSChunk(text);
        if (ttsCancelRef.current !== myGen) {
          console.log("VoiceContext: TTS worker cancelled", { myGen, currentGen: ttsCancelRef.current });
          break;
        }

        if (url) {
          try {
            console.log("VoiceContext: Dispatching TTS audio", {
              audioUrl: url,
              textLength: (text || "").length
            });
            window.dispatchEvent(new CustomEvent<string>('cu.audio.enqueue', { detail: url }));
          } catch (error) {
            console.error("VoiceContext: Failed to dispatch TTS audio", error);
          }
        } else {
          console.log("VoiceContext: No TTS audio URL received", {
            text: text || "(empty)",
            textLength: (text || "").length
          });
        }
      }
    } finally {
      ttsProcessingRef.current = false;
    }
  }, [callTTSChunk]);

  const enqueueTTSSegmentImpl = useCallback((text: string) => {
    if (!text || !text.trim()) return;

    try {
      console.log("VoiceContext: TTS chunk enqueued", {
        chunk: text.trim() || "(empty)",
        chunkLength: (text.trim() || "").length,
        queueLength: ttsTextQueueRef.current.length,
        ttsProcessing: ttsProcessingRef.current
      });
    } catch {}

    // Stop "Thinking" ring when first TTS segment is ready
    try { voicePublishState({ processingRing: false }); } catch {}
    // Minimal time-based spacing can be derived from queue pressure; for now, push then coalesce in worker
    ttsTextQueueRef.current.push(text.trim());
    void ensureTTSWorker();
  }, [ensureTTSWorker]);

  const cancelTTSImpl = useCallback(() => {
    // Bump generation to abort current worker loop and clear queue
    ttsCancelRef.current++;
    ttsTextQueueRef.current = [];
  }, []);

  // --- STT helper (built-in) ---
  const sttFromBlobImpl = useCallback(async (b: Blob, detectMs?: number): Promise<{ text: string }> => {
    // Decide path: direct-to-S3 + JSON STT for large blobs, multipart otherwise
    const shouldDirect = STT_DIRECT_UPLOAD_ENABLED && b.size >= STT_DIRECT_UPLOAD_THRESHOLD_BYTES;
    if (shouldDirect) {
      try {
        // 1) Presign
        const presignRes = await fetch("/api/v1/storage/audio/presign", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contentType: b.type || "audio/webm", sizeBytes: b.size })
        });
        const presignData: any = await presignRes.json().catch(() => ({}));
        if (!presignRes.ok) throw new Error(presignData?.error || `presign failed: ${presignRes.status}`);
        const { url, headers: putHeaders = {}, method = "PUT", objectKey } = presignData || {};
        if (!url || !objectKey) throw new Error("invalid presign payload");
        // 2) Upload
        const putRes = await fetch(url, { method, headers: putHeaders, body: b });
        if (!putRes.ok) throw new Error(`upload failed: ${putRes.status}`);
        // 3) STT via JSON with timeout + single retry
        const doOnce = async (): Promise<Response> => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);
          try {
            const res = await fetch("/api/v1/stt", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                ...(typeof detectMs === 'number' && isFinite(detectMs) && detectMs >= 0 ? { "x-detect-ms": String(Math.round(detectMs)) } : {}),
              },
              body: JSON.stringify({ objectKey, sessionId: sessionId || undefined }),
              signal: controller.signal,
            });
            return res;
          } finally {
            clearTimeout(timeoutId);
          }
        };
        let res: Response | null = null;
        let timedOut = false;
        try { res = await doOnce(); } catch (e: any) { if (e?.name === 'AbortError') timedOut = true; else throw e; }
        if (!res && timedOut) {
          try { res = await doOnce(); } catch {}
        }
        if (!res) throw new Error("stt request failed");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `stt failed: ${res.status}`);
        return { text: String(data?.text || "") };
      } catch {
        // Fallback to multipart
      }
    }

    // Multipart base64 path
    const form = new FormData();
    form.set("audio", b, "utterance.webm");
    if (sessionId) form.set("sessionId", sessionId);
    const headers: Record<string, string> = {};
    if (typeof detectMs === 'number' && isFinite(detectMs) && detectMs >= 0) headers["x-detect-ms"] = String(Math.round(detectMs));
    const doOnce = async (): Promise<Response> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);
      try {
        const res = await fetch("/api/v1/stt", { method: "POST", body: form, headers, signal: controller.signal });
        return res;
      } finally {
        clearTimeout(timeoutId);
      }
    };
    let res: Response | null = null;
    let timedOut = false;
    try { res = await doOnce(); } catch (e: any) { if (e?.name === 'AbortError') timedOut = true; else throw e; }
    if (!res && timedOut) {
      try { res = await doOnce(); } catch {}
    }
    if (!res) throw new Error("stt request failed");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `stt failed: ${res.status}`);
    return { text: String(data?.text || "") };
  }, [sessionId, STT_TIMEOUT_MS, STT_DIRECT_UPLOAD_ENABLED, STT_DIRECT_UPLOAD_THRESHOLD_BYTES]);

  // Provide adapters from within VoiceContext
  useEffect(() => {
    adapters = { enqueueTTSSegment: enqueueTTSSegmentImpl, sttFromBlob: sttFromBlobImpl };
  }, [enqueueTTSSegmentImpl, sttFromBlobImpl]);

  const value = useMemo<VoiceContextValue>(() => ({
    busy: state.busy,
    processingRing: state.processingRing,
    transcript: state.transcript,
    assistantText: state.assistantText,
    voiceError: state.voiceError,
    // Expose concrete implementations directly to avoid race with adapters useEffect
    enqueueTTSSegment: enqueueTTSSegmentImpl,
    cancelTTS: cancelTTSImpl,
    sttFromBlob: sttFromBlobImpl,
  }), [state.busy, state.processingRing, state.transcript, state.assistantText, state.voiceError, enqueueTTSSegmentImpl, cancelTTSImpl, sttFromBlobImpl]);

  return <VoiceCtx.Provider value={value}>{children}</VoiceCtx.Provider>;
}
