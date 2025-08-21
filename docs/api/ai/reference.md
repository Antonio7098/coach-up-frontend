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

## OpenAPI Spec
- FastAPI serves /openapi.json automatically.
- Snapshot into this repo when needed for docs:
  - Dev server example: curl http://127.0.0.1:8001/openapi.json > docs/api/ai/openapi.json
  - Default server: curl http://localhost:8000/openapi.json > docs/api/ai/openapi.json

## Changelog
- 2025-08-19: Added assessments (run/get) endpoints and updated chat SSE docs.
