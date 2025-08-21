# Assessments v1 — Plan

This document defines the Assessments v1 data model, background pipeline, and observability/logging for SPR-002. It complements the sprint page and will guide implementation across frontend (Convex/Next.js) and AI API (FastAPI).

## Goals
- Capture per-interaction and multi-turn assessments with consistent schema and indexes
- Group multi-turn assessments by `groupId`
- Produce end-of-session summary and render it in the UI
- Keep logging/metrics consistent with request tracing (requestId)

## Data Model (Convex — planned)
Collection: `assessments`
- id: string (Convex Id)
- userId: string (required)
- sessionId: string (required)
- trackedSkillId: string (optional; current Tracked Skill)
- interactionId: string (present for per-interaction assessments)
- groupId: string (present for multi-turn batch/run)
- kind: string (e.g., "per_interaction" | "multi_turn" | "summary")
- category: string (e.g., "correctness", "clarity", "conciseness", "fluency", etc.)
- score: number (0–1 or 0–100 depending on rubric; v1 uses 0–1)
- errors: string[] (machine-readable error codes)
- tags: string[] (freeform)
- rubricVersion: string (e.g., "v1")
- createdAt: number (ms since epoch)
- updatedAt: number (ms since epoch)

Constraints/validation:
- (kind, category) combos must be known for v1
- For per_interaction: interactionId required; for multi_turn: groupId required; for summary: groupId required
- score must be within [0, 1]

Indexes:
- by userId, sessionId, trackedSkillId
- by kind, category
- by createdAt (descending)
- by groupId (for multi-turn & summary lookups)

Example (per-interaction):
```json
{
  "userId": "u_123",
  "sessionId": "s_456",
  "interactionId": "i_789",
  "kind": "per_interaction",
  "category": "correctness",
  "score": 0.88,
  "errors": [],
  "tags": ["baseline"],
  "rubricVersion": "v1",
  "createdAt": 1690000000000
}
```

Example (multi-turn):
```json
{
  "userId": "u_123",
  "sessionId": "s_456",
  "groupId": "g_abc",
  "kind": "multi_turn",
  "category": "clarity",
  "score": 0.72,
  "errors": ["under-explained-step"],
  "tags": ["batch"],
  "rubricVersion": "v1",
  "createdAt": 1690000000000
}
```

Example (summary doc):
```json
{
  "userId": "u_123",
  "sessionId": "s_456",
  "groupId": "g_abc",
  "kind": "summary",
  "category": "session",
  "score": 0.0,
  "errors": [],
  "tags": ["summary"],
  "rubricVersion": "v1",
  "createdAt": 1690000000000,
  "summary": {
    "highlights": ["good decomposition", "clear variable naming"],
    "recommendations": ["explain time complexity", "add unit tests"],
    "categories": ["correctness", "clarity", "conciseness", "fluency"],
    "scores": { "correctness": 0.9, "clarity": 0.8, "conciseness": 0.7, "fluency": 0.85 },
    "meta": { "messageCount": 4, "durationMs": 12345, "slice": { "startIndex": 0, "endIndex": 3 } },
    "rubricVersion": "v1",
    "rubricKeyPoints": ["correctness:0.9", "clarity:0.8", "conciseness:0.7", "fluency:0.85"]
  }
}
```

## Pipeline (Multi-turn Assessment Job)
- Trigger: 
  - Heuristics: on session end, or N interactions buffered, or user idle > threshold
- Steps:
  1) Collect interactions (by sessionId) and derive `groupId`
  2) Run rubric prompts (LLM provider) to compute scores/errors/tags (per category)
  3) Persist `assessments` documents (one per category) with `groupId`
  4) Generate summary document (kind: "summary") and persist
  5) Emit events/logs for observability
- Latency target: p95 completion < 8s

## Rubric v1
- Categories: correctness, clarity, conciseness, fluency (initial set)
- Scoring: normalized [0,1]
- Versioning: `rubricVersion = "v1"`, lock prompt templates

## API Surfaces (planned)
- AI API (FastAPI):
  - POST /assessments/run (body: { sessionId }) → starts multi-turn job, returns groupId
  - GET /assessments/{sessionId} → returns latest summary and/or batch
  - Logging: include `X-Request-Id`, `route`, `sessionId`, `groupId`, `rubricVersion`, durations
- Frontend (Next.js):
  - /api/assessments/run (proxy) — optional
  - UI renders summary (on post-chat view) and per-category scores

## Observability & Logging
- Consistent with SPR-001 conventions
- JSON logs include: event, requestId, route, sessionId, groupId, rubricVersion, timings
- Metrics: p50/p95 durations for job; error rates; number of assessments per run

## Open Questions / Future
- Should we store raw model outputs? (probably no for MVP; store minimal justification snippets if needed)
- Reprocessing: add endpoint to re-run a groupId with a new rubricVersion
- Privacy: ensure PII handling; redact before logs

## Acceptance Criteria (from sprint)
- Assessments created with correct kind/category and validated
- Multi-turn assessments grouped by `groupId`
- End-of-session summary produced and visible in the UI
