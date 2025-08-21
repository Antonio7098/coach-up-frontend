# Core API (Next.js) — Reference

Overview of product/domain endpoints exposed via Next.js API routes.

## Conventions
- Base URL: /api/v1
- Auth: Authorization: Bearer <Clerk JWT>
- Request ID: X-Request-Id
- Content-Type: application/json (unless SSE)

## Endpoints (MVP)

### POST /api/v1/chat/stream
- Summary: Proxy to AI for streaming chat; relays SSE to client.
- Auth: required
- Headers: X-Request-Id, Accept: text/event-stream
- Body: { "message": string, "sessionId": string }
- Response: text/event-stream
- Notes: Emits data: and done events; see Observability for fields.

### POST /api/v1/assessments/trigger
- Summary: Enqueue multi-turn assessment for a recent interaction buffer.
- Auth: required
- Body: { "sessionId": string, "groupHint?": string }
- Response: { "status": "queued", "groupId": string }

### GET /api/v1/sessions/:id
- Summary: Fetch session details and recent interactions.
- Auth: required

### POST /api/v1/interactions
- Summary: Persist a user/AI turn to Convex.
- Auth: required

## Assessments (Convex-backed)
- POST `/api/assessments/run` — proxies AI API to start an assessment job; also persists Convex baseline (mocked when `MOCK_CONVEX=1`).
- GET  `/api/assessments/[sessionId]` — proxies AI API to fetch latest summary for a session.
- POST `/api/assessments/convex/finalize` — persists summary document to Convex (mock when `MOCK_CONVEX=1`).
- GET  `/api/assessments/convex/[sessionId]` — fetches latest Convex summary/baseline for a session.

Notes:
- See E2E toggles in `docs/api/README.md#e2e-toggles` for `SKIP_AI_CONTRACTS` and `MOCK_CONVEX` behavior during tests.

## OpenAPI Spec
- Generated from Zod schemas using zod-to-openapi.
- File: docs/api/core/openapi.json (run generator script in repo once available).

## Changelog
- 2025-08-19: Initial stub added.
