"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useMinimalVoice } from "./MinimalVoiceContext";
import { useMinimalAudio } from "./MinimalAudioContext";
import { useMinimalConversation } from "./MinimalConversationContext";

export type MinimalMicContextValue = {
  recording: boolean;
  transcript: string;
  assistantText: string;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  status: "idle" | "audio" | "stt" | "chat" | "tts" | "playback";
  vadLoop: boolean;
  toggleVadLoop: () => void;
};

const Ctx = createContext<MinimalMicContextValue | undefined>(undefined);

export function useMinimalMic() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMinimalMic must be used within MinimalMicProvider");
  return ctx;
}

export function MinimalMicProvider({ children }: { children: React.ReactNode }) {
  const voice = useMinimalVoice();
  const audio = useMinimalAudio();
  const convo = useMinimalConversation();
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const [status, setStatus] = useState<"idle" | "audio" | "stt" | "chat" | "tts" | "playback">("idle");
  const [vadLoop, setVadLoop] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const vadLoopRef = useRef<boolean>(false);
  React.useEffect(() => { vadLoopRef.current = vadLoop; }, [vadLoop]);
  const vadNodesRef = useRef<{ ac: AudioContext | null; src: MediaStreamAudioSourceNode | null; analyser: AnalyserNode | null } | null>(null);
  const skipSttOnStopRef = useRef<boolean>(false);
  const startingRef = useRef<boolean>(false);

  const stopRecording = useCallback(() => {
    try { console.log("MinimalMic: stopRecording() called; recording=", recording); } catch {}
    setRecording(false);
    try {
      const rec = mediaRef.current;
      if (rec && rec.state === "recording") rec.stop();
      mediaRef.current = null;
    } catch {}
    try {
      const s = streamRef.current;
      s?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    } catch {}
    try {
      const n = vadNodesRef.current;
      if (n?.src) { try { n.src.disconnect(); } catch {} }
      if (n?.analyser) { try { n.analyser.disconnect(); } catch {} }
      if (n?.ac) { try { n.ac.close(); } catch {} }
      vadNodesRef.current = null;
    } catch {}
  }, []);

  const cancelCurrentCapture = useCallback(() => {
    skipSttOnStopRef.current = true;
    try { console.log("MinimalMic: cancelCurrentCapture → skipSttOnStop=true"); } catch {}
    try { stopRecording(); } catch {}
  }, [stopRecording]);

  const startRecordingInternal = useCallback(async (forceVad: boolean = false) => {
    if (recording || startingRef.current) return;
    try {
      startingRef.current = true;
      try { console.log("MinimalMic: startRecording() vadLoop=", vadLoopRef.current, "forceVad=", forceVad); } catch {}
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      mediaRef.current = rec;
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) chunks.push(ev.data); };
      rec.onstop = async () => {
        try {
          try { console.log("MinimalMic: onstop fired; skipSttOnStop=", skipSttOnStopRef.current, "vadLoop=", vadLoopRef.current); } catch {}
          // Reflect capture ended immediately
          setRecording(false);
          // Ensure the media stream is torn down between turns
          try {
            const s = streamRef.current;
            s?.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
          } catch {}
          const shouldSkip = skipSttOnStopRef.current;
          const blob = new Blob(chunks, { type: "audio/webm" });
          try { console.log("MinimalMic: onstop blobSize=", blob.size); } catch {}
          if (blob.size === 0) { try { console.log("MinimalMic: empty blob; returning"); } catch {}; return; }
          if (!shouldSkip) {
            setStatus("stt"); try { console.log("MinimalMic: STT start"); } catch {}
            const { text } = await voice.sttFromBlob(blob);
            setTranscript(text); try { console.log("MinimalMic: STT done; textLen=", (text || "").length); } catch {}
            setStatus("chat"); try { console.log("MinimalMic: Chat start"); } catch {}
            const reply = await convo.chatToText(text);
            setAssistantText(reply); try { console.log("MinimalMic: Chat done; replyLen=", (reply || "").length); } catch {}
            setStatus("playback"); try { console.log("MinimalMic: TTS enqueue start"); } catch {}
            try { voice.cancelTTS?.(); } catch {}
            // Fire-and-forget TTS enqueue to allow immediate barge-in recording
            try { void voice.enqueueTTSSegment(reply); } catch {}
            if (vadLoopRef.current) {
              // Start next capture immediately while playback runs
              try { void startRecording(); } catch {}
            }
          }
        } catch {}
        finally {
          if (!vadLoopRef.current) setStatus("idle");
          skipSttOnStopRef.current = false;
        }
      };
      rec.start(100);
      setRecording(true);
      setStatus("audio"); try { console.log("MinimalMic: recording started"); } catch {}
      startingRef.current = false;
      const useVad = forceVad || vadLoopRef.current;
      if (useVad) {
        try {
          const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
          const src = ac.createMediaStreamSource(stream);
          const analyser = ac.createAnalyser();
          analyser.fftSize = 2048;
          src.connect(analyser);
          vadNodesRef.current = { ac, src, analyser };
          const data = new Uint8Array(analyser.fftSize);
          let silenceMs = 0;
          let hasSpeech = false;
          const speechThreshold = 0.03; // start-of-speech threshold
          const silenceThreshold = 0.015; // end-of-speech threshold
          const endSilenceMs = 700; // stop after ~0.7s silence following speech
          try { console.log("MinimalMic: VAD loop started", { speechThreshold, silenceThreshold, endSilenceMs }); } catch {}
          const tick = () => {
            // Use recorder state and vadLoopRef to avoid stale React state in closure
            if (rec.state !== "recording" || !vadLoopRef.current) return;
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
              const v = (data[i] - 128) / 128;
              sum += v * v;
            }
            const rms = Math.sqrt(sum / data.length);
            if (rms > speechThreshold && !hasSpeech) {
              hasSpeech = true; silenceMs = 0;
              // Barge-in: on first detected speech, cancel TTS and stop playback
              try { voice.cancelTTS?.(); } catch {}
              try { audio.stop?.(); } catch {}
              try { console.log("MinimalMic: VAD speech start; barge-in; rms=", rms.toFixed(3)); } catch {}
            }
            else if (hasSpeech && rms < silenceThreshold) { silenceMs += 100; if (silenceMs === 300) { try { console.log("MinimalMic: VAD accumulating silenceMs=", silenceMs, "rms=", rms.toFixed(3)); } catch {} } }
            else { silenceMs = 0; }
            if (hasSpeech && silenceMs >= endSilenceMs) {
              try { console.log("MinimalMic: VAD end-of-speech; stopping recorder; silenceMs=", silenceMs); } catch {}
              try { if (rec.state === "recording") { try { rec.requestData?.(); } catch {} rec.stop(); } } catch {}
              return;
            }
            window.setTimeout(tick, 100);
          };
          window.setTimeout(tick, 100);
        } catch {}
      }
    } catch {}
    finally {
      // If we failed before rec.start, clear starting state
      startingRef.current = false;
    }
  }, [recording, voice, convo]);

  const startRecording = useCallback(async () => {
    return startRecordingInternal(false);
  }, [startRecordingInternal]);

  const value = useMemo<MinimalMicContextValue>(() => ({
    recording,
    transcript,
    assistantText,
    startRecording,
    stopRecording,
    vadLoop,
    toggleVadLoop: () => {
      try { console.log("MinimalMic: toggleVadLoop() from", vadLoop); } catch {}
      const next = !vadLoop;
      setVadLoop(next);
      try { console.log("MinimalMic: vadLoop=", next); } catch {}
      if (next) {
        if (!recording && !startingRef.current) { try { void startRecordingInternal(true); } catch {} }
      } else {
        if (recording) { try { cancelCurrentCapture(); } catch {} }
      }
    },
    status,
  }), [recording, transcript, assistantText, startRecording, stopRecording, vadLoop, status]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}


