# Monitoring & Observability

This document defines metric names, example JSON log lines, and header conventions for Coach Up.

Stack context: Next.js (App Router) + Convex + Clerk + FastAPI/LangChain + Vercel; streaming via SSE/Web Streams.

## 1) Header Conventions

Send these headers from the client (or generate at the edge) and propagate through Next.js → FastAPI → upstream providers.

Required
- x-request-id: UUIDv4 per request/turn; reused across hops.
- authorization: Bearer <Clerk JWT> (Next.js verifies; FastAPI re-verifies via JWKS).

Recommended
- x-user-id: stable hash of the authenticated userId (e.g., sha256(userId + server_salt)).
- x-session-id: current chat session ID (hash allowed).
- x-focus-id: active focusId (if applicable, hash allowed).
- x-group-id: multi-turn evaluation groupId (when present, hash allowed).
- traceparent: W3C Trace Context (if you adopt OpenTelemetry later).
- x-provider: logical provider key (e.g., openai, deepgram) used for this request.
- x-model-id: model name (e.g., gpt-4o-mini).

SSE/Streaming
- accept: text/event-stream for SSE endpoints.
- cache-control: no-store for interactive endpoints.

PII & security
- Never propagate raw PII in headers. Use hashed IDs for user/session/focus/group.
- Limit header sizes; validate and strip unknown headers at service boundaries.

## 2) Metric Names & Tags

Naming
- Prefix: coachup.<service>.*
  - Services: next (Next.js), py (FastAPI), convex, web (RUM), provider (upstream LLM/STT/TTS).
- Units: suffix where helpful (e.g., latency_ms, cost_cents, tokens_in/out).
- Types: counter, gauge, histogram.

Common tags (keep cardinality bounded)
- env: production | staging | dev
- route: canonical route id (e.g., POST /api/chat)
- provider: openai|anthropic|deepgram|…
- modelId: e.g., gpt-4o-mini
- rubricVersion: e.g., v1
- userIdHash, sessionIdHash, focusIdHash, groupId: hashed identifiers

Next.js API (service: next)
- next.request.count (counter)
- next.request.errors (counter)
- next.request.latency_ms (histogram)
- next.sse.first_token_ms (histogram)
- next.stream.duration_ms (histogram)
- next.stream.disconnects (counter)
- next.provider.tokens_in (counter)
- next.provider.tokens_out (counter)
- next.provider.cost_cents (counter)
- next.provider.latency_ms (histogram)
- next.provider.errors (counter)

FastAPI (service: py)
- py.request.count, py.request.errors, py.request.latency_ms
- py.upstream.latency_ms, py.upstream.errors
- py.retries.count, py.backoff.count
- py.provider.tokens_in/out, py.provider.cost_cents

Convex (service: convex)
- convex.function.latency_ms (histogram)
- convex.function.errors (counter)
- convex.query.items_returned (histogram)
- convex.rate_limit.events (counter)

Frontend RUM (service: web)
- web.vitals.lcp_ms, web.vitals.inp_ms, web.vitals.cls
- web.vitals.ttfb_ms
- web.sse.stalls (counter)
- web.audio.start_ms (histogram)

Provider synthetic rollups (service: provider)
- provider.request.count/errors/latency_ms (by provider/modelId)
- provider.tokens_in/out, provider.cost_cents

## 3) Example JSON Logs

General rules
- Structured JSON only. One log event per line.
- Redact PII; do not log raw audio/text. Prefer hashes, sizes, and counts.
- Include requestId on every event; include user/session/focus/group hashes where relevant.

Next.js API request (success)
```json
{
  "ts": "2025-08-19T13:59:12.345Z",
  "level": "info",
  "service": "next",
  "env": "production",
  "requestId": "b7c1a5f9-2b2e-4ac6-9f0d-9f6d2e0b7a6e",
  "route": "POST /api/chat",
  "method": "POST",
  "status": 200,
  "latencyMs": 842,
  "userIdHash": "u:7e8a…",
  "sessionIdHash": "s:91b2…",
  "focusIdHash": "f:aa31…",
  "sse": { "firstTokenMs": 620, "streamDurationMs": 1780, "disconnect": false }
}
```

Provider call (timed, costed)
```json
{
  "ts": "2025-08-19T13:59:12.421Z",
  "level": "info",
  "service": "py",
  "env": "production",
  "requestId": "b7c1a5f9-2b2e-4ac6-9f0d-9f6d2e0b7a6e",
  "span": "provider.chat",
  "provider": "openai",
  "modelId": "gpt-4o-mini",
  "latencyMs": 721,
  "tokensIn": 1184,
  "tokensOut": 362,
  "costCents": 2.1,
  "status": "ok"
}
```

Background assessment job
```json
{
  "ts": "2025-08-19T14:00:03.010Z",
  "level": "info",
  "service": "py",
  "env": "production",
  "requestId": "b1f0d…",
  "job": "assessment.multi_turn",
  "sessionIdHash": "s:91b2…",
  "groupId": "grp_1",
  "focusIdHash": "f:aa31…",
  "rubricVersion": "v1",
  "interactions": 3,
  "latencyMs": 4920,
  "status": "ok"
}
```

Error with retry/backoff
```json
{
  "ts": "2025-08-19T14:00:12.111Z",
  "level": "warn",
  "service": "py",
  "env": "production",
  "requestId": "b1f0d…",
  "span": "provider.stt",
  "provider": "deepgram",
  "modelId": "nova-2",
  "error": { "type": "timeout", "message": "upstream read timeout" },
  "retry": { "attempt": 2, "max": 3, "backoffMs": 800 },
  "status": "retrying"
}
```

Convex function timing
```json
{
  "ts": "2025-08-19T14:00:22.500Z",
  "level": "info",
  "service": "convex",
  "env": "production",
  "requestId": "b7c1a5f9-2b2e-4ac6-9f0d-9f6d2e0b7a6e",
  "function": "assessments.listByFocus",
  "latencyMs": 62,
  "items": 25,
  "indexed": true,
  "status": "ok"
}
```

Frontend RUM event
```json
{
  "ts": "2025-08-19T14:00:30.002Z",
  "level": "info",
  "service": "web",
  "env": "production",
  "requestId": "b7c1a5f9-2b2e-4ac6-9f0d-9f6d2e0b7a6e",
  "page": "/chat",
  "webVitals": { "lcpMs": 1600, "inpMs": 90, "cls": 0.02, "ttfbMs": 120 },
  "sse": { "stalls": 0, "firstTokenMs": 700 }
}
```

## 4) SLO Hookups & Alerts (summary)

- Tie p95 chat full-turn latency, first-token, and error rate to alerts.
- Watch provider error rate/timeouts and assessment backlog latency.
- Track daily cost per DAU; alert on 3-day moving average breaching budget.

## 5) Redaction & Privacy

- Never log raw audio/text; include lengths/counts and hashes only.
- Hash identifiers with a server-side salt rotated periodically.
- Keep logs for the minimum retention window aligned with your privacy policy.
