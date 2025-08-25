# AI API (FastAPI) — Reference

Overview of AI endpoints (chat streaming, assessments, summaries) served by the Python FastAPI service.

## Conventions
- Base URL: /v1
- Auth: service-to-service (Next.js → FastAPI) using JWT verification or shared secret for background jobs
- Request ID: X-Request-Id (propagated)
- Tracked Skill: X-Tracked-Skill-Id (optional). The AI API hashes this value (SHA-256) and only the hash (`trackedSkillIdHash`) is logged/persisted.
- Content-Type: application/json (requests); text/event-stream for streaming

## Endpoints (MVP)

### GET /chat/stream
- Summary: Stream tokens via SSE for chat.
- Headers: X-Request-Id, Accept: text/event-stream
- Query: prompt? (optional)
- Response: text/event-stream

curl (direct to AI API):
```bash
curl -N -H 'Accept: text/event-stream' 'http://localhost:8000/chat/stream?prompt=Hello'
```

curl (via frontend proxy):
```bash
curl -N 'http://localhost:3000/api/chat?prompt=Hello'
```

### POST /assessments/run
- Summary: Start a multi-turn assessment job for a session; returns a groupId (stub in SPR-002 start).
- Body: { "sessionId": string }
- Response: { "groupId": string, "status": "accepted" }

curl (direct) with optional tracked skill header:
```bash
# Use --json (auto-sets header). Include X-Tracked-Skill-Id to enable privacy-preserving correlation:
curl -s \
  -H 'X-Tracked-Skill-Id: skill_public_speaking' \
  --json '{"sessionId":"s_demo"}' \
  http://localhost:8000/assessments/run

# Or with explicit header, escaping inner quotes:
curl -s -H "content-type: application/json" \
  --data-binary "{\"sessionId\":\"s_demo\"}" \
  http://localhost:8000/assessments/run

# Or pipe JSON via stdin (robust inside bash -lc blocks):
printf %s "{\"sessionId\":\"s_demo\"}" | \
  curl -s -H "content-type: application/json" \
  --data-binary @- http://localhost:8000/assessments/run
```

curl (via proxy):
```bash
# Use --json (auto-sets header). Include X-Tracked-Skill-Id if available:
curl -s \
  -H 'X-Tracked-Skill-Id: skill_public_speaking' \
  --json '{"sessionId":"s_demo"}' \
  http://localhost:3000/api/assessments/run

# Or with explicit header, escaping inner quotes:
curl -s -H "content-type: application/json" \
  --data-binary "{\"sessionId\":\"s_demo\"}" \
  http://localhost:3000/api/assessments/run

# Or pipe JSON via stdin (robust inside bash -lc blocks):
printf %s "{\"sessionId\":\"s_demo\"}" | \
  curl -s -H "content-type: application/json" \
  --data-binary @- http://localhost:3000/api/assessments/run
```

TypeScript example:
```ts
const res = await fetch('/api/assessments/run', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sessionId: 's_demo' }),
});
const data = await res.json(); // { groupId, status }
```

Notes:
- The frontend proxy forwards any incoming query string to the AI API. You can also call:
  - curl -s -X POST 'http://localhost:3000/api/assessments/run?sessionId=s_demo'
- When using bash -lc '...', prefer the stdin or escaped-quote patterns above to avoid malformed JSON.

### GET /assessments/{sessionId}
- Summary: Fetch latest assessment summary for a session.
- Response: { sessionId, latestGroupId, summary: { highlights[], recommendations[], categories[], scores{...}, meta{...}, rubricVersion, rubricKeyPoints[] } }

Example response:

```json
{
  "sessionId": "s_demo",
  "latestGroupId": "g_abc",
  "summary": {
    "highlights": ["good decomposition"],
    "recommendations": ["explain time complexity"],
    "categories": ["correctness", "clarity", "conciseness", "fluency"],
    "scores": { "correctness": 0.9, "clarity": 0.8, "conciseness": 0.7, "fluency": 0.85 },
    "meta": { "messageCount": 4, "durationMs": 12345, "slice": { "startIndex": 0, "endIndex": 3 } },
    "rubricVersion": "v1",
    "rubricKeyPoints": ["correctness:0.9", "clarity:0.8", "conciseness:0.7", "fluency:0.85"]
  }
}
```

curl (direct):
```bash
curl -s http://localhost:8000/assessments/s_demo | jq .
```

curl (via proxy):
```bash
curl -s http://localhost:3000/api/assessments/s_demo | jq .
```

TypeScript example:
```ts
const res = await fetch('/api/assessments/s_demo');
const summary = await res.json();
```

### GET /health
- Summary: healthcheck endpoint.

## Voice Mode usage (end-to-end)

- Record mic audio in the browser (e.g., `MediaRecorder`) with client-side silence detection to auto-stop after speech ends.
- Upload audio via Core API multipart STT: `POST /api/v1/stt` (stores to S3 and transcribes in one request).
  - See Core reference: `docs/api/core/reference.md#post-apiv1stt` and `#multipart-upload-direct-file`.
- Stream an assistant reply from the AI API: `GET /chat/stream` (SSE).
- Synthesize audio incrementally via Core API TTS: `POST /api/v1/tts` (returns `audioUrl` per segment or final text).
  - See Core reference: `docs/api/core/reference.md#post-apiv1tts`.
- Play TTS segments using a stable, always-mounted `<audio>` element with a small playback queue and barge-in support.

Minimal TS playback queue (single hidden `<audio>`, queue, barge-in):

```ts
// A single, stable audio element avoids re-render interruptions
const audioEl = new Audio();
audioEl.preload = 'auto';
audioEl.hidden = true; // keep it mounted
document.body.appendChild(audioEl);

const queue: string[] = [];
let playing = false;

function playNext() {
  if (playing) return;
  const url = queue.shift();
  if (!url) return;
  playing = true;
  audioEl.onended = () => {
    playing = false;
    playNext();
  };
  audioEl.onerror = () => {
    playing = false;
    playNext();
  };
  audioEl.src = url;
  audioEl.play().catch(() => {
    // Autoplay may require a user gesture depending on browser settings
  });
}

export function enqueueTts(url: string) {
  queue.push(url);
  if (!playing) playNext();
}

export function bargeIn() {
  queue.length = 0; // clear pending segments
  try { audioEl.pause(); } catch {}
  playing = false;
}
```

Notes
- Call `bargeIn()` when new user speech starts to cancel current playback and clear the queue.
- The browser recording + silence detection example lives in `ui/src/app/chat/voice/page.tsx`.

## OpenAPI Spec
- FastAPI serves /openapi.json automatically.
- Snapshot into this repo when needed for docs:
  - Dev server example: curl http://127.0.0.1:8000/openapi.json > docs/api/ai/openapi.json
  - Default server: curl http://localhost:8000/openapi.json > docs/api/ai/openapi.json

## Changelog
- 2025-08-19: Added assessments (run/get) endpoints and updated chat SSE docs.
