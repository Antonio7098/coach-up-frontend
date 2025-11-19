/**
 * Headless Voice Chat Engine
 *
 * This module contains the core voice chat business logic extracted from MicContext.
 * It provides a clean interface for voice processing without React dependencies.
 */

import React from "react";

export type VoiceEngineState = "idle" | "recording" | "processing" | "speaking" | "error";

export type AssessmentChip = {
  id: string;
  status: "queued" | "done" | "error";
  createdAt: number;
  summary?: Record<string, unknown>;
};

export interface VoiceEngineConfig {
  vadThreshold: number;
  vadMaxSilenceMs: number;
  bargeRmsThreshold: number;
  bargeMinFrames: number;
  maxUtterMs: number;
  minSpeechMs: number;
  silenceDebounceFrames: number;
  vadGraceMs: number;
  voiceLoop: boolean;
  alwaysOn: boolean;
}

export interface VoiceEngineDependencies {
  // STT function
  sttFromBlob: (blob: Blob, detectMs?: number) => Promise<{ text: string }>;

  // Chat function
  chatToText: (prompt: string, options?: { includeHistory?: boolean }) => Promise<string>;

  // TTS functions
  enqueueTTSSegment: (text: string) => void;
  cancelTTS: () => void;
  stopPlaybackAndClear: () => void;
  waitForQueueToDrain: (timeoutMs: number) => Promise<void>;
  pausePlayback: () => void;

  // Chat streaming control
  cancelActiveChatStream: () => void;

  // Message ingestion
  ingestMessage: (role: "user" | "assistant", content: string) => Promise<void>;

  // Assessment polling
  pollAssessments: (sessionId: string, onAssessmentComplete: (assessment: AssessmentChip) => void) => void;
  stopAssessmentPolling: () => void;

  // Session management
  getSessionId: () => string | null;

  // Event logging
  logEvent: (event: string, data?: Record<string, any>) => void;
}

export interface VoiceEngineEvents {
  onStateChange: (state: VoiceEngineState) => void;
  onTranscriptChange: (transcript: string) => void;
  onAssistantTextChange: (text: string) => void;
  onError: (error: string) => void;
  onAssessmentUpdate: (chips: AssessmentChip[]) => void;
  onVADStateChange: (speaking: boolean) => void;
  onRecordingStateChange: (recording: boolean) => void;
  onInteractionStateChange: (state: "active" | "idle", groupId?: string, turnCount?: number) => void;
}

export class VoiceChatEngine {
  private state: VoiceEngineState = "idle";
  private config: VoiceEngineConfig;
  private deps: VoiceEngineDependencies;
  private events: VoiceEngineEvents;

  // Internal state
  private transcript = "";
  private assistantText = "";
  private voiceError = "";
  private recording = false;
  private inputSpeaking = false;
  private interactionState: "active" | "idle" = "idle";
  private interactionGroupId?: string;
  private interactionTurnCount = 0;
  private assessmentChips: AssessmentChip[] = [];

  // Media references
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private vadInterval: number | null = null;
  private bargeInterval: number | null = null;
  private stopTimer: number | null = null;
  private bargeStream: MediaStream | null = null;
  private bargeAudioContext: AudioContext | null = null;

  // Processing state
  private processing = false;
  private chunks: BlobPart[] = [];
  private chunkBytes = 0;
  private voiceLoop = true;

  // VAD state
  private speechFrames = 0;
  private bargeArmed = false;
  private trackMuted = false;
  private lastSpeechTs = 0;
  private firstSpeechTs: number | null = null;
  private silenceFrames = 0;

  // Refs for callbacks
  private recStartTs: number | null = null;
  private recFirstChunkTs: number | null = null;
  private bargeTriggerTs: number | null = null;

  constructor(
    config: VoiceEngineConfig,
    deps: VoiceEngineDependencies,
    events: VoiceEngineEvents
  ) {
    this.config = config;
    this.deps = deps;
    this.events = events;
  }

  // Public API
  public getState() {
    return {
      state: this.state,
      transcript: this.transcript,
      assistantText: this.assistantText,
      voiceError: this.voiceError,
      recording: this.recording,
      inputSpeaking: this.inputSpeaking,
      interactionState: this.interactionState,
      interactionGroupId: this.interactionGroupId,
      interactionTurnCount: this.interactionTurnCount,
      assessmentChips: this.assessmentChips,
      config: this.config,
    };
  }

  public async startRecording(): Promise<void> {
    if (this.recording || this.processing) {
      return;
    }

    this.voiceError = "";
    this.bargeArmed = true;
    this.speechFrames = 0;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });

      const mime = this.getSupportedMimeType();
      this.mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      this.chunks = [];
      this.chunkBytes = 0;
      this.recStartTs = Date.now();
      this.recFirstChunkTs = null;

      this.setupMediaRecorder();
      this.mediaRecorder.start(100);
      this.recording = true;
      this.events.onRecordingStateChange(true);

      if (!this.config.alwaysOn) {
        this.setupAutoStopTimer();
      }

      this.setupVAD(stream);
      this.logEvent("voice.record.start");

    } catch (error) {
      this.voiceError = error instanceof Error ? error.message : "Failed to start recording";
      this.events.onError(this.voiceError);
      this.logEvent("voice.record.error", { error: this.voiceError });
    }
  }

  public stopRecording(): void {
    this.logEvent("voice.record.stop", { reason: "user" });
    this.voiceLoop = false;

    this.cleanupTimers();
    this.cleanupVAD();
    this.cleanupBargeMonitor();

    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      this.mediaRecorder.stop();
    }

    this.recording = false;
    this.events.onRecordingStateChange(false);
    this.events.onVADStateChange(false);
  }

  public toggleVoiceLoop(): void {
    if (this.voiceLoop) {
      this.stopVoiceLoop();
    } else {
      this.startVoiceLoop();
    }
  }

  public setVoiceLoop(enabled: boolean): void {
    if (enabled !== this.voiceLoop) {
      this.toggleVoiceLoop();
    }
  }

  public clear(): void {
    this.transcript = "";
    this.assistantText = "";
    this.voiceError = "";
    this.events.onTranscriptChange(this.transcript);
    this.events.onAssistantTextChange(this.assistantText);
    this.events.onError("");

    this.deps.stopPlaybackAndClear();
  }

  public async sendPrompt(prompt: string): Promise<string> {
    if (!prompt.trim()) return "";

    this.setState("processing");
    this.events.onTranscriptChange(prompt);

    try {
      const reply = await this.deps.chatToText(prompt);
      this.assistantText = reply;
      this.events.onAssistantTextChange(reply);
      return reply;
    } catch (error) {
      this.voiceError = error instanceof Error ? error.message : "Chat failed";
      this.events.onError(this.voiceError);
      throw error;
    } finally {
      this.setState("idle");
    }
  }

  public updateConfig(newConfig: Partial<VoiceEngineConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public destroy(): void {
    this.cleanupAll();
  }

  // Private methods
  private setState(state: VoiceEngineState): void {
    this.state = state;
    this.events.onStateChange(state);
  }

  private getSupportedMimeType(): string | null {
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/wav"
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return null;
  }

  private setupMediaRecorder(): void {
    if (!this.mediaRecorder) return;

    this.mediaRecorder.ondataavailable = (event) => {
      if (!this.recording || !this.mediaRecorder) return;

      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data);
        this.chunkBytes += event.data.size;

        // Debug: log first chunk timing and ongoing chunk sizes
        this.logEvent("voice.record.chunk", {
          bytes: event.data.size,
          totalBytes: this.chunkBytes,
          chunks: this.chunks.length,
        });

        if (!this.recFirstChunkTs) {
          this.recFirstChunkTs = Date.now();
          const t0 = this.recStartTs || this.recFirstChunkTs;

          if (this.bargeTriggerTs) {
            const restartMs = this.recFirstChunkTs - this.bargeTriggerTs;
            this.logEvent("voice.barge.restart_ms", { restartMs });
          }

          // Time to first chunk from start
          if (t0) {
            this.logEvent("voice.record.first_chunk_ms", { ms: this.recFirstChunkTs - t0 });
          }
        }
      }
    };

    this.mediaRecorder.onstop = async () => {
      await this.handleRecordingStop();
    };
  }

  private async handleRecordingStop(): Promise<void> {
    this.recording = false;
    this.events.onRecordingStateChange(false);
    this.events.onVADStateChange(false);

    this.cleanupTimers();
    this.cleanupVAD();
    this.cleanupBargeMonitor();

    if (!this.voiceLoop) {
      this.setState("idle");
      return;
    }

    if (this.processing) {
      this.setState("idle");
      return;
    }

    this.processing = true;

    try {
      const mime = this.getSupportedMimeType() || "audio/webm";
      const blob = new Blob(this.chunks, { type: mime });

      // Debug: log stop with blob stats
      this.logEvent("voice.record.stopped", {
        blobType: mime,
        blobBytes: blob.size,
        chunkCount: this.chunks.length,
      });

      if (blob.size > 0 && this.voiceLoop) {
        await this.processVoiceLoop(blob);
      } else {
        this.setState("idle");
      }
    } catch (error) {
      this.voiceError = error instanceof Error ? error.message : "Processing failed";
      this.events.onError(this.voiceError);
      this.processing = false;
      this.setState("idle");
    }
  }

  private async processVoiceLoop(blob: Blob): Promise<void> {
    try {
      const t0 = this.recStartTs || 0;
      const tFirst = this.recFirstChunkTs || 0;
      const detectMs = tFirst && t0 ? (tFirst - t0) : undefined;

      const { text } = await this.deps.sttFromBlob(blob, detectMs);

      if (text && text.trim()) {
        this.transcript = text;
        this.events.onTranscriptChange(text);

        await this.deps.ingestMessage("user", text);

        const reply = await this.deps.chatToText(text, { includeHistory: true });
        this.assistantText = reply;
        this.events.onAssistantTextChange(reply);

        await this.deps.ingestMessage("assistant", reply);

        // Wait for TTS to complete before restarting
        if (!this.config.alwaysOn) {
          await this.deps.waitForQueueToDrain(6000);
          this.deps.stopPlaybackAndClear();
          await this.startRecording();
        }
      } else {
        this.voiceError = "No speech detected";
        this.events.onError(this.voiceError);
      }
    } catch (error) {
      this.voiceError = error instanceof Error ? error.message : "Voice chat failed";
      this.events.onError(this.voiceError);
    } finally {
      this.processing = false;
      this.setState("idle");
    }
  }

  private setupAutoStopTimer(): void {
    this.cleanupTimers();
    this.stopTimer = window.setTimeout(() => {
      if (this.recording && this.mediaRecorder && this.mediaRecorder.state === "recording") {
        this.logEvent("voice.record.auto_stop", { reason: "timeout" });
        this.mediaRecorder.stop();
      }
    }, this.config.maxUtterMs);
  }

  private setupVAD(stream: MediaStream): void {
    this.cleanupVAD();

    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

      // Handle context state changes
      this.audioContext.onstatechange = () => {
        if (this.audioContext?.state === "suspended") {
          this.audioContext.resume().catch(() => {});
        }
      };

      const source = this.audioContext.createMediaStreamSource(stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const buffer = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
      this.lastSpeechTs = Date.now();
      this.firstSpeechTs = null;
      this.silenceFrames = 0;

      this.vadInterval = window.setInterval(() => {
        this.processVADFrame(analyser, buffer);
      }, 100);

    } catch (error) {
      this.logEvent("voice.vad.error", { error: error instanceof Error ? error.message : "Unknown" });
    }
  }

  private processVADFrame(analyser: AnalyserNode, buffer: Float32Array): void {
    try {
      analyser.getFloatTimeDomainData(buffer as Float32Array<ArrayBuffer>);

      // Downsampled RMS for efficiency
      let sum = 0;
      let count = 0;
      for (let i = 0; i < buffer.length; i += 32) {
        const v = buffer[i];
        sum += v * v;
        count++;
      }
      const rms = Math.sqrt(sum / Math.max(1, count));

      // Periodic VAD frame diagnostics (every 5 frames)
      if ((this.silenceFrames + this.speechFrames) % 5 === 0) {
        this.logEvent("voice.vad.frame", {
          rms,
          vadThreshold: this.config.vadThreshold,
          speechFrames: this.speechFrames,
          silenceFrames: this.silenceFrames,
          trackMuted: this.trackMuted,
          recording: this.recording,
        });
      }

      // Handle muted tracks
      if (this.trackMuted) {
        this.lastSpeechTs = Date.now();
        this.silenceFrames = 0;
        this.events.onVADStateChange(false);
        return;
      }

      // Process speech detection
      if (rms >= this.config.vadThreshold) {
        this.speechFrames++;
        this.lastSpeechTs = Date.now();
        this.silenceFrames = 0;

        if (!this.firstSpeechTs) {
          this.firstSpeechTs = this.lastSpeechTs;
        }

        this.events.onVADStateChange(true);
      } else {
        this.silenceFrames++;
        const now = Date.now();
        const hadSpeech = this.firstSpeechTs != null;
        const graceOk = this.firstSpeechTs ? (now - this.firstSpeechTs) >= this.config.vadGraceMs : false;
        const minSpeechOk = this.firstSpeechTs ? (now - this.firstSpeechTs) >= this.config.minSpeechMs : false;
        const sustainedSilence = (now - this.lastSpeechTs) > this.config.vadMaxSilenceMs &&
                                this.silenceFrames >= this.config.silenceDebounceFrames;

        this.events.onVADStateChange(false);

        if (hadSpeech && graceOk && minSpeechOk && sustainedSilence) {
          this.logEvent("voice.vad.auto_stop");
          if (this.recording && this.mediaRecorder && this.mediaRecorder.state === "recording") {
            this.mediaRecorder.stop();
          }
        }
      }
    } catch (error) {
      // Log VAD errors for diagnostics
      this.logEvent("voice.vad.error", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private setupBargeMonitor(): void {
    this.cleanupBargeMonitor();

    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    }).then(stream => {
      this.bargeStream = stream;
      this.bargeAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

      const source = this.bargeAudioContext.createMediaStreamSource(stream);
      const analyser = this.bargeAudioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const buffer = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
      this.bargeArmed = true;
      this.speechFrames = 0;

      this.bargeInterval = window.setInterval(() => {
        this.processBargeFrame(analyser, buffer);
      }, 50);
    }).catch(() => {
      this.cleanupBargeMonitor();
    });
  }

  private processBargeFrame(analyser: AnalyserNode, buffer: Float32Array): void {
    try {
      analyser.getFloatTimeDomainData(buffer as Float32Array<ArrayBuffer>);

      let sum = 0;
      let count = 0;
      for (let i = 0; i < buffer.length; i += 32) {
        const v = buffer[i];
        sum += v * v;
        count++;
      }
      const rms = Math.sqrt(sum / Math.max(1, count));

      if (this.bargeArmed && rms >= this.config.bargeRmsThreshold) {
        this.handleBargeIn();
      } else {
        this.speechFrames = Math.max(0, this.speechFrames - 1);
      }
    } catch (error) {
      // Silently handle barge monitor errors
    }
  }

  private handleBargeIn(): void {
    this.logEvent("voice.barge.trigger");
    this.bargeTriggerTs = Date.now();
    this.bargeArmed = false;

    // Interrupt current processing
    this.deps.pausePlayback();
    this.deps.stopPlaybackAndClear();
    this.deps.cancelActiveChatStream();
    this.deps.cancelTTS();
    this.setState("idle");

    // Stop barge monitor
    this.cleanupBargeMonitor();

    // Start recording
    this.startRecording();
  }

  private startVoiceLoop(): void {
    this.voiceLoop = true;
    this.setState("idle");
    this.events.onVADStateChange(false);

    if (!this.recording) {
      this.startRecording();
    }
  }

  private stopVoiceLoop(): void {
    this.voiceLoop = false;
    this.cleanupAll();
  }

  private cleanupAll(): void {
    this.cleanupTimers();
    this.cleanupVAD();
    this.cleanupBargeMonitor();
    this.cleanupMediaRecorder();
  }

  private cleanupTimers(): void {
    if (this.stopTimer) {
      window.clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }

  private cleanupVAD(): void {
    if (this.vadInterval) {
      window.clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  private cleanupBargeMonitor(): void {
    if (this.bargeInterval) {
      window.clearInterval(this.bargeInterval);
      this.bargeInterval = null;
    }
    if (this.bargeAudioContext) {
      this.bargeAudioContext.close();
      this.bargeAudioContext = null;
    }
    if (this.bargeStream) {
      this.bargeStream.getTracks().forEach(track => track.stop());
      this.bargeStream = null;
    }
    this.speechFrames = 0;
    this.bargeArmed = false;
  }

  private cleanupMediaRecorder(): void {
    if (this.mediaRecorder) {
      if (this.mediaRecorder.state === "recording") {
        this.mediaRecorder.stop();
      }
      this.mediaRecorder = null;
    }
    this.chunks = [];
    this.chunkBytes = 0;
  }

  private logEvent(event: string, data?: Record<string, any>): void {
    this.deps.logEvent(event, data);
    // ALWAYS log critical voice events to console for diagnostics
    if (event.startsWith("voice.vad.") || event.startsWith("voice.record.") || event.startsWith("voice.stt.") || event.startsWith("voice.error.")) {
      console.log(`[VoiceEngine] ${event}`, data);
    }
  }
}

// React hook factory
export function useVoiceChatEngine(
  config: VoiceEngineConfig,
  deps: VoiceEngineDependencies
): {
  state: VoiceEngineState;
  transcript: string;
  assistantText: string;
  voiceError: string;
  recording: boolean;
  inputSpeaking: boolean;
  interactionState: "active" | "idle";
  interactionGroupId?: string;
  interactionTurnCount: number;
  assessmentChips: AssessmentChip[];
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  toggleVoiceLoop: () => void;
  setVoiceLoop: (enabled: boolean) => void;
  sendPrompt: (prompt: string) => Promise<string>;
  clear: () => void;
  updateConfig: (config: Partial<VoiceEngineConfig>) => void;
  destroy: () => void;
} {
  const [state, setState] = React.useState<VoiceEngineState>("idle");
  const [transcript, setTranscript] = React.useState("");
  const [assistantText, setAssistantText] = React.useState("");
  const [voiceError, setVoiceError] = React.useState("");
  const [recording, setRecording] = React.useState(false);
  const [inputSpeaking, setInputSpeaking] = React.useState(false);
  const [interactionState, setInteractionState] = React.useState<"active" | "idle">("idle");
  const [interactionGroupId, setInteractionGroupId] = React.useState<string | undefined>();
  const [interactionTurnCount, setInteractionTurnCount] = React.useState(0);
  const [assessmentChips, setAssessmentChips] = React.useState<AssessmentChip[]>([]);

  const engineRef = React.useRef<VoiceChatEngine | null>(null);

  if (!engineRef.current) {
    engineRef.current = new VoiceChatEngine(
      config,
      deps,
      {
        onStateChange: setState,
        onTranscriptChange: setTranscript,
        onAssistantTextChange: setAssistantText,
        onError: setVoiceError,
        onAssessmentUpdate: setAssessmentChips,
        onVADStateChange: setInputSpeaking,
        onRecordingStateChange: setRecording,
        onInteractionStateChange: (state, groupId, turnCount) => {
          setInteractionState(state);
          setInteractionGroupId(groupId);
          setInteractionTurnCount(turnCount || 0);
        },
      }
    );
  }

  React.useEffect(() => {
    engineRef.current?.updateConfig(config);
  }, [config]);

  React.useEffect(() => {
    return () => {
      engineRef.current?.destroy();
    };
  }, []);

  return {
    state,
    transcript,
    assistantText,
    voiceError,
    recording,
    inputSpeaking,
    interactionState,
    interactionGroupId,
    interactionTurnCount,
    assessmentChips,
    startRecording: () => engineRef.current?.startRecording() || Promise.resolve(),
    stopRecording: () => engineRef.current?.stopRecording(),
    toggleVoiceLoop: () => engineRef.current?.toggleVoiceLoop(),
    setVoiceLoop: (enabled) => engineRef.current?.setVoiceLoop(enabled),
    sendPrompt: (prompt) => engineRef.current?.sendPrompt(prompt) || Promise.resolve(""),
    clear: () => engineRef.current?.clear(),
    updateConfig: (newConfig) => engineRef.current?.updateConfig(newConfig),
    destroy: () => engineRef.current?.destroy(),
  };
}
