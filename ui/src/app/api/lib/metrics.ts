/* eslint-disable no-console */
import client from "prom-client";

// Ensure a singleton registry across hot reloads in Next.js
const g = globalThis as unknown as {
  __coachupProm?: {
    registry: client.Registry;
    metrics: {
      requestsTotal: client.Counter<string>;
      requestErrorsTotal: client.Counter<string>;
      requestDurationSeconds: client.Histogram<string>;
      audioBytesIn: client.Counter<string>;
      audioBytesOut: client.Counter<string>;
      storageBytesUploaded: client.Counter<string>;
      storagePresignBytesPlanned: client.Counter<string>;
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

  return {
    registry,
    metrics: { requestsTotal, requestErrorsTotal, requestDurationSeconds, audioBytesIn, audioBytesOut, storageBytesUploaded, storagePresignBytesPlanned },
  } as const;
}

if (!g.__coachupProm) {
  g.__coachupProm = createMetrics();
}

export const promRegistry: client.Registry = g.__coachupProm!.registry;
export const promMetrics = g.__coachupProm!.metrics;
