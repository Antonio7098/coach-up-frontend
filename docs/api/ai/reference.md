# AI API (FastAPI) — Reference

Overview of AI endpoints (chat streaming, assessments, summaries) served by the Python FastAPI service.

## Conventions
- Base URL: /v1
- Auth: service-to-service (Next.js → FastAPI) using JWT verification or shared secret for background jobs
- Request ID: X-Request-Id (propagated)
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

curl (direct):
```bash
curl -s -H 'content-type: application/json' \
  -d '{"sessionId":"s_demo"}' \
  http://localhost:8000/assessments/run
```

curl (via proxy):
```bash
curl -s -H 'content-type: application/json' \
  -d '{"sessionId":"s_demo"}' \
  http://localhost:3000/api/assessments/run
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

### GET /assessments/{sessionId}
- Summary: Fetch latest assessment summary for a session (stub response for now).
- Response: { sessionId, latestGroupId, summary: { highlights[], recommendations[], rubricVersion } }

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
