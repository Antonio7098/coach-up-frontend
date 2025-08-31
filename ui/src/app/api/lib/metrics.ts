/* eslint-disable no-console */
import client from "prom-client";

// Ensure a singleton registry across hot reloads in Next.js
const g = globalThis as unknown as {
  __coachupProm?: {
    registry: client.Registry;
    metrics: {
      requestsTotal: client.Counter<string>;
      requestErrorsTotal: client.Counter<string>;
      rateLimitedTotal: client.Counter<string>;
      requestDurationSeconds: client.Histogram<string>;
      audioBytesIn: client.Counter<string>;
      audioBytesOut: client.Counter<string>;
      storageBytesUploaded: client.Counter<string>;
      storagePresignBytesPlanned: client.Counter<string>;
      sttLatencyMs: client.Histogram<string>;
      ttsLatencyMs: client.Histogram<string>;
      chatFirstTokenMs: client.Histogram<string>;
      clientDetectMs: client.Histogram<string>;
      voiceEventsTotal: client.Counter<string>;
      voiceTtsPlaybackMs: client.Histogram<string>;
      chatDisconnectsTotal: client.Counter<string>;
    };
  };
};

function createMetrics() {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });

  const labelNames = ["route", "method", "status", "mode"] as const;

  const requestsTotal = new client.Counter({
    name: "coachup_ui_api_requests_total",
    help: "Total number of UI API requests",
    labelNames: labelNames as unknown as string[],
    registers: [registry],
  });

  const requestErrorsTotal = new client.Counter({
    name: "coachup_ui_api_request_errors_total",
    help: "Total number of UI API request errors (5xx)",
    labelNames: labelNames as unknown as string[],
    registers: [registry],
  });

  const rateLimitedTotal = new client.Counter({
    name: "coachup_ui_api_rate_limited_total",
    help: "Total number of UI API requests rate limited (429)",
    labelNames: labelNames as unknown as string[],
    registers: [registry],
  });

  const requestDurationSeconds = new client.Histogram({
    name: "coachup_ui_api_request_duration_seconds",
    help: "UI API request duration in seconds",
    labelNames: labelNames as unknown as string[],
    buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  // Byte counters (map to docs logical metrics):
  // - docs: next.audio.bytes_in -> prom: coachup_ui_audio_bytes_in_total
  const audioBytesIn = new client.Counter({
    name: "coachup_ui_audio_bytes_in_total",
    help: "Total audio bytes received or fetched for STT",
    labelNames: labelNames as unknown as string[],
    registers: [registry],
  });

  // - docs: next.audio.bytes_out -> prom: coachup_ui_audio_bytes_out_total
  const audioBytesOut = new client.Counter({
    name: "coachup_ui_audio_bytes_out_total",
    help: "Total synthesized audio bytes returned to clients",
    labelNames: labelNames as unknown as string[],
    registers: [registry],
  });

  // - docs: next.storage.bytes_uploaded -> prom: coachup_ui_storage_bytes_uploaded_total
  const storageBytesUploaded = new client.Counter({
    name: "coachup_ui_storage_bytes_uploaded_total",
    help: "Total bytes of audio uploaded to storage by the API",
    labelNames: labelNames as unknown as string[],
    registers: [registry],
  });

  // - docs: next.storage.presign.bytes_planned -> prom: coachup_ui_storage_presign_bytes_planned_total
  const storagePresignBytesPlanned = new client.Counter({
    name: "coachup_ui_storage_presign_bytes_planned_total",
    help: "Sum of requested content length for presigned uploads (planned bytes)",
    labelNames: labelNames as unknown as string[],
    registers: [registry],
  });

  // Latency histograms (milliseconds)
  const commonMsBuckets = [25, 50, 75, 100, 150, 250, 400, 600, 800, 1200, 2000, 3000, 5000, 8000, 12000];

  const sttLatencyMs = new client.Histogram({
    name: "coachup_ui_stt_latency_ms",
    help: "End-to-end STT latency in milliseconds (UI API)",
    labelNames: labelNames as unknown as string[],
    buckets: commonMsBuckets,
    registers: [registry],
  });

  const ttsLatencyMs = new client.Histogram({
    name: "coachup_ui_tts_latency_ms",
    help: "End-to-end TTS latency in milliseconds (UI API)",
    labelNames: labelNames as unknown as string[],
    buckets: commonMsBuckets,
    registers: [registry],
  });

  const chatFirstTokenMs = new client.Histogram({
    name: "coachup_ui_chat_first_token_ms",
    help: "Latency to first token from upstream chat SSE in milliseconds",
    labelNames: labelNames as unknown as string[],
    buckets: commonMsBuckets,
    registers: [registry],
  });

  const clientDetectMs = new client.Histogram({
    name: "coachup_ui_client_detect_ms",
    help: "Client-reported mic detection time in milliseconds",
    labelNames: labelNames as unknown as string[],
    buckets: [50, 100, 200, 300, 500, 800, 1200, 2000, 3000, 5000],
    registers: [registry],
  });

  // Client voice telemetry
  // Counter for client-side voice events (e.g., vad state, pipeline state, tts playback events)
  const voiceEventsTotal = new client.Counter({
    name: "coachup_ui_voice_events_total",
    help: "Total number of client voice events ingested",
    labelNames: ["event", "state", "outcome", "route", "method", "status", "mode"] as unknown as string[],
    registers: [registry],
  });

  // Histogram for client-reported TTS playback durations
  const voiceTtsPlaybackMs = new client.Histogram({
    name: "coachup_ui_voice_tts_playback_ms",
    help: "Client-reported TTS playback duration in milliseconds",
    labelNames: ["outcome", "route", "method", "status", "mode"] as unknown as string[],
    buckets: commonMsBuckets,
    registers: [registry],
  });

  // Disconnect reasons for SSE/chat proxy
  const chatDisconnectsTotal = new client.Counter({
    name: "coachup_ui_chat_disconnects_total",
    help: "Count of chat SSE disconnects by reason",
    labelNames: ["route", "reason"] as unknown as string[],
    registers: [registry],
  });

  return {
    registry,
    metrics: { requestsTotal, requestErrorsTotal, rateLimitedTotal, requestDurationSeconds, audioBytesIn, audioBytesOut, storageBytesUploaded, storagePresignBytesPlanned, sttLatencyMs, ttsLatencyMs, chatFirstTokenMs, clientDetectMs, voiceEventsTotal, voiceTtsPlaybackMs, chatDisconnectsTotal },
  } as const;
}

if (!g.__coachupProm) {
  g.__coachupProm = createMetrics();
}

export const promRegistry: client.Registry = g.__coachupProm!.registry;
export const promMetrics = g.__coachupProm!.metrics;
