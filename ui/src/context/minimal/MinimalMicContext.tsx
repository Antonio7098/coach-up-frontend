"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useMinimalVoice } from "./MinimalVoiceContext";
import { useMinimalAudio } from "./MinimalAudioContext";
import { useMinimalConversation } from "./MinimalConversationContext";
import { useMinimalSession } from "./MinimalSessionContext";

export type MinimalMicContextValue = {
  recording: boolean;
  transcript: string;
  assistantText: string;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  status: "idle" | "audio" | "stt" | "chat" | "tts" | "playback";
  vadLoop: boolean;
  toggleVadLoop: () => void;
  inputSpeaking: boolean;
};

const Ctx = createContext<MinimalMicContextValue | undefined>(undefined);

export function useMinimalMic() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMinimalMic must be used within MinimalMicProvider");
  return ctx;
}

export function MinimalMicProvider({
  children,
  userProfile,
  userGoals,
  customSystemPrompt
}: {
  children: React.ReactNode;
  userProfile?: any;
  userGoals?: any[];
  customSystemPrompt?: string;
}) {

  const voice = useMinimalVoice();
  const audio = useMinimalAudio();
  const convo = useMinimalConversation();
  const { sessionId } = useMinimalSession();


  const sessionIdRef = useRef<string | null>(null);
  React.useEffect(() => { sessionIdRef.current = sessionId || null; }, [sessionId]);

  // Refs to track current profile/goals for use in async callbacks
  const userProfileRef = useRef<any>(null);
  const userGoalsRef = useRef<any[]>([]);
  const customSystemPromptRef = useRef<string>("");

  // Update refs when props change
  React.useEffect(() => {
    userProfileRef.current = userProfile;
    userGoalsRef.current = userGoals || [];
    customSystemPromptRef.current = customSystemPrompt || "";
  }, [userProfile, userGoals, customSystemPrompt]);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const [status, setStatus] = useState<"idle" | "audio" | "stt" | "chat" | "tts" | "playback">("idle");
  const [vadLoop, setVadLoop] = useState(false);
  const [inputSpeaking, setInputSpeaking] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);


  const streamRef = useRef<MediaStream | null>(null);
  const vadLoopRef = useRef<boolean>(false);
  React.useEffect(() => { vadLoopRef.current = vadLoop; }, [vadLoop]);
  const vadNodesRef = useRef<{ ac: AudioContext | null; src: MediaStreamAudioSourceNode | null; analyser: AnalyserNode | null } | null>(null);
  const skipSttOnStopRef = useRef<boolean>(false);
  const startingRef = useRef<boolean>(false);
  const playbackActiveRef = useRef<boolean>(false);
  React.useEffect(() => { playbackActiveRef.current = audio.isPlaybackActive; }, [audio.isPlaybackActive]);
  const pendingPlaybackRef = useRef<boolean>(false);
  React.useEffect(() => {
    if (audio.isPlaybackActive) {
      pendingPlaybackRef.current = false;
      if (status === "tts") setStatus("playback");
    } else {
      // When playback ends naturally, if we're looping/recording, return to audio
      if (status === "playback" && (recording || vadLoopRef.current)) setStatus("audio");
    }
  }, [audio.isPlaybackActive, status, recording]);
  const ttsActiveRef = useRef<boolean>(false);
  React.useEffect(() => {
    ttsActiveRef.current = (status === "tts" || status === "playback");
    try { console.log("MinimalMic: TTS/playback state:", { status, ttsActive: ttsActiveRef.current, playbackActive: playbackActiveRef.current, pending: pendingPlaybackRef.current }); } catch {}
  }, [status]);
  const bargeInActiveRef = useRef<boolean>(false);
  const resumeAfterBargeInRef = useRef<boolean>(false);

  const stopRecording = useCallback(() => {
    try { console.log("MinimalMic: stopRecording() called; recording=", recording); } catch {}
    setRecording(false);
    setInputSpeaking(false);
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
    bargeInActiveRef.current = false;
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

            const chatOptions = {
              userProfile: userProfileRef.current,
              userGoals: userGoalsRef.current,
              customSystemPrompt: customSystemPromptRef.current && customSystemPromptRef.current.trim() ? customSystemPromptRef.current.trim() : undefined
            };


            const reply = await convo.chatToText(text, chatOptions);
            setAssistantText(reply); try { console.log("MinimalMic: Chat done; replyLen=", (reply || "").length); } catch {}
            // Persist interactions to backend to enable server cadence
            try {
              const sid = (sessionIdRef.current || '').toString();
              if (sid) {
                const now = Date.now();
                const reqId = Math.random().toString(36).slice(2);
                const djb2 = (input: string): string => {
                  const s = (input || '').trim();
                  if (s.length === 0) return '0';
                  let h = 5381;
                  for (let i = 0; i < s.length; i++) { h = ((h << 5) + h) ^ s.charCodeAt(i); }
                  return (h >>> 0).toString(16);
                };
                // user message
                try { console.log('[ingest] mic → POST user', { sid, len: (text || '').length }); } catch {}
                void fetch('/api/v1/interactions', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', 'x-request-id': reqId },
                  body: JSON.stringify({ sessionId: sid, messageId: `m_user_${now}`, role: 'user', contentHash: djb2(text || `m_user_${now}`), text, ts: now })
                }).catch(() => {});
                // assistant message (slightly later ts)
                try { console.log('[ingest] mic → POST assistant', { sid, len: (reply || '').length }); } catch {}
                void fetch('/api/v1/interactions', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', 'x-request-id': reqId },
                  body: JSON.stringify({ sessionId: sid, messageId: `m_assistant_${now+1}`, role: 'assistant', contentHash: djb2((reply || `m_assistant_${now+1}`)), text: reply, ts: now + 1 })
                }).catch(() => {});
              } else {
                try { console.warn('[ingest] mic skip: no sessionId available yet'); } catch {}
              }
            } catch {}
            setStatus("tts"); try { console.log("MinimalMic: TTS start"); } catch {}
            try { voice.cancelTTS?.(); } catch {}

            // Use streaming TTS instead of waiting for full response
            let accumulatedText = "";
            const onChunk = (chunk: string) => {
              accumulatedText += chunk;
              // Process chunk for TTS immediately (sentence-based)
              void voice.enqueueTTSChunk?.(chunk);
            };

            // Get streaming response
            const streamingOptions = {
              userProfile: userProfileRef.current,
              userGoals: userGoalsRef.current,
              customSystemPrompt: customSystemPromptRef.current && customSystemPromptRef.current.trim() ? customSystemPromptRef.current.trim() : undefined
            };


            const streamingReply = await convo.chatToTextStreaming(text, onChunk, streamingOptions);

            // Final TTS for any remaining text (in case streaming missed some)
            if (accumulatedText && accumulatedText !== streamingReply) {
              try { void voice.enqueueTTSChunk?.(streamingReply.slice(accumulatedText.length)); } catch {}
            }

            setAssistantText(streamingReply); try { console.log("MinimalMic: Chat done; replyLen=", (streamingReply || "").length); } catch {}
            // Ensure concurrent capture during playback for barge-in
            if (vadLoopRef.current && !recording) { try { void startRecordingInternal(true); } catch {} }
          }
        } catch {}
        finally {
          if (!vadLoopRef.current) setStatus("idle");
          skipSttOnStopRef.current = false;
          bargeInActiveRef.current = false;
          if (resumeAfterBargeInRef.current && vadLoopRef.current && !recording) {
            resumeAfterBargeInRef.current = false;
            try { console.log("MinimalMic: restarting capture after barge-in"); } catch {}
            try { void startRecordingInternal(true); } catch {}
          }
        }
      };
      rec.start(100);
      setRecording(true);
      // If playback is ongoing or pending, do not flip to audio; otherwise show audio
      if (!audio.isPlaybackActive && !pendingPlaybackRef.current) { setStatus("audio"); }
      try { console.log("MinimalMic: recording started"); } catch {}
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
          let speechMs = 0;
          const baseSpeechThreshold = 0.03;
          const playbackSpeechThreshold = 0.035; // lower to recognize speech over playback
          const silenceThreshold = 0.015; // end-of-speech threshold
          const minSpeechMsBase = 100;  // ≥100ms voiced frames when idle (support short words)
          const minSpeechMsPlayback = 200; // ≥200ms voiced frames during playback
          const debounceMs = 80; // extra debounce before barge-in
          const endSilenceMs = 700; // stop after ~0.7s silence following speech
          try { console.log("MinimalMic: VAD loop started", { baseSpeechThreshold, playbackSpeechThreshold, silenceThreshold, minSpeechMsBase, minSpeechMsPlayback, debounceMs, endSilenceMs }); } catch {}
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
            const isPlayback = ttsActiveRef.current || playbackActiveRef.current || pendingPlaybackRef.current;
            const speechThreshold = isPlayback ? playbackSpeechThreshold : baseSpeechThreshold;
            const minSpeechMs = isPlayback ? minSpeechMsPlayback : minSpeechMsBase;
            const incMs = 100;
            const decMs = isPlayback ? 30 : 30; // slower decay so intermittent speech accumulates
            // removed periodic VAD tick log
            if (!hasSpeech) {
              const before = speechMs;
              if (rms > speechThreshold) { speechMs += incMs; } else { speechMs = Math.max(0, speechMs - decMs); }
              // removed noisy VAD accumulator log
              const requiredMs = minSpeechMs + debounceMs;
              if (speechMs >= requiredMs) {
                hasSpeech = true; silenceMs = 0;
                // Barge-in path
                if (isPlayback) {
                  bargeInActiveRef.current = true;
                  skipSttOnStopRef.current = true;
                  resumeAfterBargeInRef.current = true;
                  try { voice.cancelTTS?.(); } catch {}
                  try { console.log("MinimalMic: calling audio.stop() for barge-in"); } catch {}
                  try { audio.stop?.(); } catch {}
                  try { console.log("MinimalMic: VAD speech start; barge-in;", { rms: Number(rms.toFixed(3)), speechMs, speechThreshold, requiredMs, ttsActive: ttsActiveRef.current, playbackActive: playbackActiveRef.current }); } catch {}
                  // Switch to audio immediately for barge-in and clear pending playback marker
                  try { pendingPlaybackRef.current = false; } catch {}
                  try { setStatus("audio"); } catch {}
                  // Stop current recorder to flush and then restart fresh capture in onstop
                  try { if (rec.state === "recording") rec.stop(); } catch {}
                  return;
                } else {
                  try { console.log("MinimalMic: VAD speech start (no playback)", { rms: Number(rms.toFixed(3)) }); } catch {}
                }
                try { setInputSpeaking(true); } catch {}
              }
            }
            if (hasSpeech && rms < silenceThreshold) { silenceMs += 100; if (silenceMs === 300) { try { console.log("MinimalMic: VAD accumulating silenceMs=", silenceMs, "rms=", rms.toFixed(3)); } catch {} } }
            else { silenceMs = 0; }
            const endSil = bargeInActiveRef.current ? 400 : endSilenceMs;
            if (hasSpeech && silenceMs >= endSil) {
              try { console.log("MinimalMic: VAD end-of-speech; stopping recorder; silenceMs=", silenceMs); } catch {}
              try { setInputSpeaking(false); } catch {}
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
    inputSpeaking,
  }), [recording, transcript, assistantText, startRecording, stopRecording, vadLoop, status, inputSpeaking]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}


