# CoachUp: Technical Plan & Architecture

This document provides a comprehensive technical overview of the CoachUp system, covering data models, system architecture, assessment logic, and session management.

## 1. Core Data Models

- User – Profile info.
  - Fields: `id`, `name`, `email`

- Skill – Predefined pathway for learning a skill with ranked levels (0–10) and criteria for progression.
  - Fields: `id`, `title`, `description`, `levels[]` (each level has `criteria`, optional `examples`, `rubricHints`)

- UserSession – Continuous conversation container.
  - Fields: `id`, `userId`, `startTime`, `endTime`

- Tracked Skill – User-selected skills (up to 3 active) and ordering.
  - Fields: `id`, `userId`, `skillId`, `order` (1–3), `active`, `startedAt`, `updatedAt`

- Focus Insight (V2 — non-MVP) – Actionable recommendations generated from assessments to help progress a tracked skill.
  - Fields: `id`, `userId`, `trackedSkillId`, `sourceAssessmentIds[]`, `type`, `message`, `priority`, `status`, `createdAt`, `resolvedAt?`

- Interaction – One turn in chat.
  - Fields: `id`, `sessionId`, `inputMode` ("text" | "voice"), `userText?`, `userAudioUrl?`, `sttText?`, `aiResponse`, `ttsAudioUrl?`, `timestamp`

- Assessment – Structured feedback, per-turn or multi-turn.
  - Fields:
    - `id`, `userId`, `sessionId`, `interactionIds[]`, `trackedSkillId`
    - `kind` ("interaction" | "multi_turn" | "session_summary")
    - `category` ("error" | "progress")
    - `score` (1–10 or null)
    - `explanationText`
    - `errors?`: `[{ key, message, severity, suggestion?, span? }]`
    - `tags?`: `string[]`
    - `focusAreas?`: `[{ title, action, priority }]` (specific, actionable steps to improve the chosen skill)
    - `groupId?`: `string` (groups per-focus assessments from the same multi-turn evaluation)
    - `rubricVersion?`: `string`
    - `consolidatedFocusAreas?`: `[{ title, action, priority }]` (session_summary only; 2–3 key actions)
    - `createdAt`: `number`
  - Note (MVP): assessments are computed from STT transcripts only; no audio feature extraction (prosody, pacing, stutter) is used.

## 2. Skill Progression (1–10 Scale)

Dynamic progression per skill, based on aggregated Assessments:

- 1–3 Novice: Frequent errors, low scores.
- 4–7 Developing: Mixed errors and successes.
- 8–10 Mastery: Consistent strong performance.

### Level Mapping (MVP)

- Compute an EMA (exponential moving average) of `score` over the last N progress assessments for a given `trackedSkillId` (e.g., N=20, EMA α=0.3). Count only `category = "progress"`.
- Map EMA to levels:
  - 1–3: EMA < 4
  - 4–7: 4 ≤ EMA < 8
  - 8–10: EMA ≥ 8
- Use this simple mapping for explainability. Adjust thresholds later without schema changes.

## 3. Multi-Agent Architecture

- Real-Time Chat Agent
  - Fast responses, logs Interactions.
  - Voice mode (MVP): captures mic input, obtains STT transcript, and logs `Interaction` with `inputMode="voice"`, `userAudioUrl?`, and `sttText`.

- Background Analysis Agent
  - Lightweight filter → decides if assessment is needed and scope (per-turn or multi-turn).
  - Assessment Agent → performs deep analysis and generates Assessments.
  - MVP constraint: reads transcript text only; audio features are ignored until post-MVP.

- End-of-Session Review Agent
  - Summarizes all Assessments into holistic session feedback and consolidates Focus Areas into 2–3 key actionable changes.

## 4. Assessment Logic

### Kinds and Categories

MVP input modality: analysis uses STT transcripts only; no prosody/pacing/stutter detection from raw audio.

- `kind` defines scope:
  - `interaction`: exactly one `interactionId`.
  - `multi_turn`: two or more `interactionIds`.
  - `session_summary`: no `interactionIds` (0); optional overall score/explanation.
- `category` defines purpose:
  - `error`: identifies mistakes; drives top-error aggregation.
  - `progress`: contributes to level/EMA and progression.
- Validation rules:
  - `interaction` ⇒ `interactionIds.length === 1`
  - `multi_turn` ⇒ `interactionIds.length >= 2`
  - `session_summary` ⇒ `interactionIds.length === 0`
- Grouping:
  - For one multi-turn evaluation emitting multiple per-focus assessments, set the same `groupId` on each record.

### Focus Areas

- Focus Areas: specific, actionable steps to improve the score in the user’s chosen skill.
- Generation:
  - On each `interaction` or `multi_turn` assessment, generate 1–3 `focusAreas` derived from detected errors/progress and rubric guidance.
  - Each item has `{ title, action, priority }` where `priority` ∈ {low, medium, high}.
- Consolidation:
  - On `session_summary`, aggregate recent `focusAreas` and emit 2–3 `consolidatedFocusAreas` that represent the most impactful changes to make next.

### Per-Interaction

- For atomic skills (grammar, vocabulary, tone).
- Assesses latest `userText` + `aiResponse`.

### Multi-Turn

- For multi-turn tasks requiring context (e.g., sales pitch, interview).
- Uses a short-term buffer (3–6 turns).
- Triggered when buffer is “complete” (task ends or user requests feedback).
- Produces one or more per-focus Assessments tied to the same `interactionIds` and sharing a `groupId`.

### Session Summary

- Optional overall assessment per session.
- `kind = session_summary`, `interactionIds = []`.
- May include an overall `score` and high-level `explanationText`; per-focus details remain in atomic Assessments.

### Triggers

- Error detection
- Skill attempt detection
- Periodic checks
- User request

### Indexes & Queries (Convex)

- Assessments: index by `userId`, `sessionId`, `trackedSkillId`, `kind`, `createdAt`, `groupId`.
- Tracked Skill: index by `userId`, `active`.
- Typical reads:
  - Last N assessments by `trackedSkillId` for dashboard/progression.
  - Latest `session_summary` by `sessionId` for post-chat view.
  - Fetch all per-focus multi_turn assessments by `groupId` for a single evaluation.

### Examples

Interaction assessment (JSON):

```json
{
  "id": "ass_1",
  "userId": "u_1",
  "sessionId": "sess_1",
  "interactionIds": ["int_9"],
  "trackedSkillId": "focus_assertiveness",
  "kind": "interaction",
  "category": "error",
  "score": null,
  "explanationText": "Past tense error.",
  "errors": [
    {"key": "past_tense", "message": "Use 'went'.", "severity": "low", "suggestion": "I went..."}
  ],
  "focusAreas": [
    {"title": "Reduce hedging", "action": "Replace 'I think' with direct statements in closing lines.", "priority": "medium"}
  ],
  "createdAt": 1692453123456
}
```

Multi-turn per-focus assessments tied by groupId:

```json
[
  {
    "id": "ass_2a",
    "userId": "u_1",
    "sessionId": "sess_1",
    "interactionIds": ["int_8", "int_9", "int_10"],
    "trackedSkillId": "focus_assertiveness",
    "kind": "multi_turn",
    "category": "progress",
    "score": 7,
    "explanationText": "Stronger closing ask; fewer hedges.",
    "groupId": "grp_1",
    "createdAt": 1692453124000
  },
  {
    "id": "ass_2b",
    "userId": "u_1",
    "sessionId": "sess_1",
    "interactionIds": ["int_8", "int_9", "int_10"],
    "trackedSkillId": "focus_word_choice",
    "kind": "multi_turn",
    "category": "progress",
    "score": 6,
    "explanationText": "Improved precision; avoid 'revert' for 'reply'.",
    "groupId": "grp_1",
    "createdAt": 1692453124500
  }
]
```

Session summary:

```json
{
  "id": "ass_3",
  "userId": "u_1",
  "sessionId": "sess_1",
  "interactionIds": [],
  "trackedSkillId": null,
  "kind": "session_summary",
  "category": "progress",
  "score": 7,
  "explanationText": "Clear structure; next: reduce hedging and refine word choice.",
  "consolidatedFocusAreas": [
    {"title": "Fewer hedges", "action": "Eliminate 'maybe/just/I think' from openings and closes.", "priority": "high"},
    {"title": "Sharper asks", "action": "End with a clear, singular call-to-action.", "priority": "high"}
  ],
  "createdAt": 1692453125000
}
```

## 5. Session Management

- Start: First message after inactivity → new `UserSession`.
- End: Auto-close after 15–30 minutes idle.
- Ensures self-contained, analyzable sessions.

## 6. Sequence Diagrams

### a) Per-Interaction Assessment

```mermaid
sequenceDiagram
  participant User
  participant ChatAgent
  participant AnalysisAgent
  participant AssessmentAgent

  User->>ChatAgent: Sends message
  ChatAgent->>AnalysisAgent: Logs Interaction
  AnalysisAgent->>AnalysisAgent: Lightweight check (atomic skill?)
  alt Needs assessment
    AnalysisAgent->>AssessmentAgent: Request per-turn analysis
    AssessmentAgent->>AnalysisAgent: Create Assessment (1 interactionId)
  end
```

### b) Voice input path (MVP)

```mermaid
sequenceDiagram
  participant User
  participant UI
  participant STT as STTProvider
  participant ChatAgent
  participant AnalysisAgent

  User->>UI: Speaks (mic stream)
  UI->>STT: Send audio (stream/batch)
  STT-->>UI: Transcript (partial/final)
  UI->>ChatAgent: Submit transcript (sttText)
  ChatAgent->>AnalysisAgent: Log Interaction (inputMode="voice")
  AnalysisAgent->>AnalysisAgent: Lightweight check
```

### c) Multi-Turn Assessment

```mermaid
sequenceDiagram
  participant User
  participant ChatAgent
  participant AnalysisAgent
  participant AssessmentAgent

  User->>ChatAgent: Sends message(s)
  ChatAgent->>AnalysisAgent: Logs Interactions
  AnalysisAgent->>AnalysisAgent: Lightweight check (task mode?)
  loop Task buffer
    AnalysisAgent->>AnalysisAgent: Add Interactions to buffer
  end
  alt Task complete
    AnalysisAgent->>AssessmentAgent: Request batch analysis
    AssessmentAgent->>AnalysisAgent: Create Assessment (multiple interactionIds)
  end
```

## 7. Benefits

- Scalable: Filters prevent unnecessary LLM calls.
- Targeted: Feedback tied to actual skill attempts.
- Flexible: Supports per-turn micro feedback and multi-turn macro evaluation.
- User-Centric: Inline corrections + holistic scenario reviews.

## 8. Tech Stack

### Key Components of the Tech Stack

- Next.js for the frontend and backend (App Router, Server Actions, API Routes).
- Convex for the database with real-time updates and end-to-end type safety in TypeScript.
- Clerk for authentication and billing.
- shadcn/ui and Tailwind CSS for the user interface.
- Vercel for hosting and edge/runtime optimizations.
- Python AI service using FastAPI.
- STT provider for voice input (e.g., Deepgram/Whisper). TTS provider for audio replies.

### Integration Overview

- Next.js app handles the web UI and lightweight server logic; protected by Clerk.
- Convex stores users, sessions, interactions, assessments; real-time updates drive live UI.
- AI flows are delegated to a Python FastAPI service.
- Next.js API routes call the Python service for real-time chat assistance and background assessments.
- Streaming responses: server-sent events/Web Streams from Python → Next.js → client.
- Voice path: client captures audio, obtains STT transcript (client or server-proxied provider), and submits text for analysis. TTS renders AI replies as audio.
- Deployed on Vercel; Convex manages its own infrastructure; Python service deployed as a separate service (e.g., Vercel partner integration or container host).
- For the MVP chat streaming implementation plan, see sprint: [SPR-001 — MVP Chat Core](../ops/sprints/SPR-001.md).

```mermaid
flowchart LR
  UI[Next.js + shadcn/ui + Tailwind] --> API[Next.js API Routes]
  API -->|Auth| Clerk[Clerk]
  API --> Convex[(Convex DB)]
  API --> Py[Python FastAPI]
  Py --> LLM[LLM Provider(s)]
  Convex <-->|RT updates| UI
  API -.deploy.-> Vercel[Vercel Hosting]
```

## 9. Operational Notes

### 9.1 Service-to-Service Auth

- Next.js → FastAPI: verify Clerk JWT in FastAPI (issuer, audience, JWKS cache).
- Propagate a requestId header from client → Next.js → FastAPI; include in all logs with userId/sessionId/trackedSkillId/groupId (hashed if needed).
- Allow anonymous read-only health checks; require auth for AI/chat endpoints.

### 9.2 Observability & Tracing

- Structured JSON logs in both services with fields: `ts`, `level`, `requestId`, `userId`, `sessionId`, `groupId?`, `trackedSkillId?`, `route`, `latencyMs`, `sttProvider?`, `sttModelId?`, `ttsProvider?`, `ttsModelId?`.
- Emit counters/timers for p95 latency and error rates per endpoint and provider.
- Add simple trace IDs now; optional OpenTelemetry later to stitch Next.js ↔ FastAPI.

### 9.3 Rate Limiting & Backoff

- Per-user quotas: turns/min, audio seconds/day, concurrent streams.
- Additional voice-mode guardrails (MVP): max utterance duration, max concurrent mic streams per user.
- Client-visible 429 with retry-after; exponential backoff for transient provider errors.
- Guardrails on audio upload size/type and maximum session duration.
### 9.4 Vendor Abstraction & Reproducibility

- Define thin interfaces: `ChatProvider`, `STTProvider`, `TTSProvider` with `provider` and `modelId`.
- Feature-flag provider swaps; keep prompt/rubric text versioned (`rubricVersion`).
- Prefer keeping Assessment lean; for full reproducibility, add a minimal PromptRun log (optional, background written):

PromptRun (optional, not a core dependency):

```json
{
  "id": "pr_1",
  "requestId": "req_123",
  "userId": "u_1",
  "sessionId": "sess_1",
  "interactionIds": ["int_8", "int_9"],
  "groupId": "grp_1",
  "provider": "openai",
  "modelId": "gpt-4o-mini",
  "rubricVersion": "v1",
  "inputTokens": 1200,
  "outputTokens": 350,
  "latencyMs": 820,
  "costCents": 1.9,
  "status": "ok",
  "createdAt": 1692453123456
}
```

Indexes: by `requestId`, `userId`, `sessionId`, `groupId`, `createdAt`.

### 9.5 Budgets, Alerts, and Privacy

- Budget alarms per provider/model; circuit-breaker to a cheaper model on threshold.
- Alert on p95 > targets, STT/TTS failure rates, timeouts, and queue backlog.
- Privacy: short retention window for raw audio (ephemeral for STT), encryption at rest/in transit, strict bucket policies; transcripts retained per policy.

## 10. Performance & Monitoring

See Monitoring doc for headers, metrics, and log formats: [Monitoring & Observability](../ops/monitoring.md).

### 10.1 SLOs & Budgets (MVP)

- Realtime chat (text): p95 time-to-first-token < 1.2s; p95 full-turn < 2.5s; error rate < 1%.
- Realtime chat (STT): p95 transcript availability < 600ms for <5s utterances; < 1.2s for <10s utterances.
- Realtime chat (TTS): p95 audio start < 1.8s.
- Background multi-turn assessment: p95 completion < 8s; success ≥ 99%.
- Session summary generation: p95 < 3s.
- Availability: 99.5% for chat/assessment endpoints (business hours).
- Cost guardrail: max cost per DAU; alert if 3-day MA exceeds threshold.

### 10.2 Metrics to Emit

- Next.js API routes
  - request.count, request.errors, request.latency_ms (histogram)
  - sse.first_token_ms, stream.duration_ms, stream.disconnects
  - provider.request.count/errors/latency_ms, tokens.in/out, cost.cents
- FastAPI (AI service)
  - mirror provider metrics; upstream_latency_ms; retries/backoff.count
  - stt.request.count/errors, stt.latency_ms (hist), stt.transcript_confidence (avg), stt.stream.partial_updates
  - tts.request.count/errors, tts.latency_ms (hist), tts.audio_start_ms (hist)
- Convex
  - function.latency_ms, function.errors, query.items_returned, rate_limit.events
- Frontend RUM
  - Web Vitals (LCP, INP, CLS, TTFB), sse.stalls, stt.first_transcript_ms, audio.start_ms

Include tags when reasonable: route, provider, modelId, rubricVersion, and hashed userId/sessionId/trackedSkillId/groupId to limit cardinality.

### 10.3 Dashboards

- Realtime Chat Health: first-token and full-turn latency p50/p95, error rate, SSE disconnects, retries/timeouts.
- Background Assessments: completion latency, error rate by provider/modelId and rubricVersion, groupId batch sizes.
- Cost & Provider Health: tokens and cost by provider/modelId, fallback usage, budget headroom.

### 10.4 Alerts

- p95 chat full-turn > 2.5s for 5 min.
- Provider error rate > 3% for 5 min or 10 consecutive timeouts.
- Assessment backlog > N or p95 completion > 8s for 10 min.
- Daily cost > budget or forecasted overrun in next 24h.
- Convex function errors > 0.5% or p95 latency > 500ms.
- STT transcript p95 latency > targets for 5 min or STT error rate > 3%.
 - TTS audio start p95 > 1.8s for 5 min or TTS error rate > 3%.

### 10.5 Instrumentation Notes

- IDs & tracing: generate requestId at client/edge; propagate client → Next.js → FastAPI → provider; include in all logs with userId/sessionId/trackedSkillId/groupId (hashed if needed).
- Logging: structured JSON fields: ts, level, requestId, userId, sessionId, trackedSkillId?, groupId?, route, latencyMs, provider, modelId, tokensIn, tokensOut, costCents, status. Redact PII; never log raw audio/text.
- Next.js: stream replies (Web Streams), flush headers early; avoid blocking work in API routes; reuse HTTP/2 connections; cache provider clients.
- FastAPI: async endpoints; shared httpx.AsyncClient with timeouts and jittered retries; concurrency guards for fan-out; cache Clerk JWKS; verify JWT per request.
- Convex: always use indexes; paginate; avoid N+1; keep records small; denormalize small counters only if reads spike.
- Tracing: start with requestId and span-like logs; add OpenTelemetry SDKs later to emit OTLP traces.

### 10.6 Load & Chaos Tests

- k6/Locust: 20–50 concurrent chat sessions with SSE; assert SLOs and backpressure.
- Playwright: E2E happy path with timing assertions.
- Chaos: inject provider 500/timeout spikes; verify fallback and alerts.

## 11. Benchmarking & LLM Provider Evaluation

Purpose
- Compare providers/models on quality, latency (TTFT and full turn), cost, robustness, and safety.

Approach (MVP)
- Offline: golden dataset (200–300 items) per task type; judge via rubric (pairwise) plus heuristics; aggregate with win rates and cost/latency.
- Online: A/B via feature flags; sticky bucketing per user/session; success = correction acceptance, rating, and latency.
- Provider matrix: small fast model for realtime; larger model for background; define a cheaper fallback with circuit breaker.

Artifacts & Logging
- Log PromptRun with requestId, provider/modelId, rubricVersion, tokens, cost, latency.
- Emit provider metrics and add a simple “Benchmark Results” dashboard.

See the detailed guide: [Benchmarking & LLM Provider Evaluation](../ops/benchmarking.md)

## 12. Dev & E2E Environment (Summary)

- Servers spun up by Playwright (see `ui/playwright.config.ts`):
  - FastAPI (AI API): `http://127.0.0.1:8000`
  - Next.js UI: `http://localhost:3100` with fresh server per run (`reuseExistingServer=false`)
- Key environment variables for local runs:
  - UI webServer env: `CSS_TRANSFORMER_WASM=1`, `AI_API_BASE_URL=http://127.0.0.1:8000`, `MOCK_CONVEX=1`, `PERSIST_ASSESSMENTS_SECRET`, `NEXT_PUBLIC_STT_PROVIDER`, `NEXT_PUBLIC_TTS_PROVIDER`, `ENABLE_TTS=1`
  - Server env (if server-proxying STT/TTS): `STT_API_KEY`, `TTS_API_KEY`
  - Real Convex: `MOCK_CONVEX=0`, `CONVEX_URL`, `NEXT_PUBLIC_CONVEX_URL`
- Mock behavior:
  - When `MOCK_CONVEX=1`, `POST /api/assessments/convex/finalize` in the UI skips Authorization enforcement to avoid 401s during tests.
  - AI API persists a placeholder summary on ingestion `start/continue` so `GET /assessments/{sessionId}` yields a non-null `latestGroupId` immediately.
  - Mock STT path for E2E: return canned transcripts for mic recordings when mocks are enabled.
- Example local E2E flow (from `coach-up-frontend/ui/`):
  - Install deps: `npm install`
  - Install browsers: `npx playwright install --with-deps chromium`
  - Run E2E: `PERSIST_ASSESSMENTS_SECRET=test-secret npx playwright test --project=chromium`
- Persistence callback (AI API):
  - `PERSIST_ASSESSMENTS_URL` can point to `http://localhost:3100/api/assessments/convex/finalize`
  - `PERSIST_ASSESSMENTS_SECRET` should match the UI server env; in mock mode the UI route skips auth.

For detailed steps and troubleshooting, see `docs/api/README.md`.