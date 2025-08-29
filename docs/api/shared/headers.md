# Shared API Headers & Conventions

## Auth
- Authorization: Bearer <Clerk JWT> (Core API)
- Service auth (Core → AI): JWT verification (issuer/audience) or shared secret for background workers

## Request ID
- X-Request-Id: stable per client request; propagate client → Next.js → FastAPI → provider

## Idempotency
- Idempotency-Key: optional request header echoed by the server in responses.
  - Currently implemented on `GET /api/v1/session-summary` for tracing and future idempotency semantics.
  - Response will include `Idempotency-Key` when provided by the client.

## Tracked Skill (privacy-preserving)
- X-Tracked-Skill-Id: optional; raw tracked skill identifier provided by the client.
  - The server hashes this value (SHA-256) and only the hash (`trackedSkillIdHash`) is logged/persisted.
  - The raw value is never logged or stored.
  - Use this to correlate assessments and events with a user-selected tracked skill without exposing the underlying ID.
  - Client → Server example:
    ```bash
    curl -s \
      -H 'X-Request-Id: req_123' \
      -H 'X-Tracked-Skill-Id: skill_public_speaking' \
      http://localhost:3000/api/assessments/run
    ```

### Provider Skill-Tracing (server-propagated)
- X-Tracked-Skill-Id-Hash: SHA-256 hash of `X-Tracked-Skill-Id`, added by the server on upstream provider requests for correlation.
  - Upstream provider calls include both headers: `X-Tracked-Skill-Id` and `X-Tracked-Skill-Id-Hash`.
  - Logs and persistence only include the hash (`trackedSkillIdHash`); the raw ID is never logged or stored.
  - Example (conceptual) server → provider request headers:
    ```http
    X-Request-Id: req_123
    X-Tracked-Skill-Id: skill_public_speaking
    X-Tracked-Skill-Id-Hash: 5a5b2e2c7c3b3b4f...  
    ```

## Content Types
- application/json for REST
- text/event-stream for SSE streaming endpoints

## Rate Limits
- 429 with `Retry-After` header on limit exceeded.
- Implemented headers (in-memory, best-effort) on `GET /api/v1/session-summary` responses:
  - `X-RateLimit-Limit`: burst capacity for the token bucket.
  - `X-RateLimit-Remaining`: remaining tokens after this request.
  - `X-RateLimit-Reset`: seconds until tokens are replenished.
  - On 429, `Retry-After` is also included.
- Notes:
  - Limiting is per client key derived from `x-forwarded-for`/`x-real-ip` and `user-agent`.
  - This limiter is in-memory and not suitable for multi-instance production without a shared store.

### Metrics
- Prometheus counter for rate-limited responses: `coachup_ui_api_rate_limited_total{route,method,status,mode}`.
  - Example route label: `/api/v1/session-summary`

## Tracing
- Include requestId in all logs; optionally include hashed userId/sessionId/trackedSkillId/groupId
