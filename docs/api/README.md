# Coach Up API Docs

This folder contains human-friendly references and machine-readable specs for both services:

- Core API (Next.js API routes)
- AI API (FastAPI)

## Structure
- core/
  - reference.md — overview, examples, and changelog
  - openapi.json — generated OpenAPI spec (zod-to-openapi suggested)
- ai/
  - reference.md — overview, examples, and changelog
  - openapi.json — exported from FastAPI (/openapi.json)
- shared/
  - headers.md — auth, request ID, rate limits, content types
  - errors.md — error model and codes

## Conventions
- Versioning: path-based `/api/v1/...`
- Auth: `Authorization: Bearer <Clerk JWT>` for Core API; service-to-service secrets for background jobs.
- Request ID: `X-Request-Id` propagated client → Next.js → FastAPI.
- Streaming: `text/event-stream` for SSE endpoints.
- Errors: consistent JSON envelope.

## Maintaining the specs
- Update schemas close to code (Zod/Pydantic) and regenerate OpenAPI on change.
- Keep reference.md examples up to date in the same PR as code changes.
- Optional: lint OpenAPI with Spectral in CI.

## E2E toggles
- SKIP_AI_CONTRACTS
  - When set to `1` or `true`, Playwright skips AI contract tests and does not start the FastAPI server.
  - Use for UI-only smoke runs.
- MOCK_CONVEX
  - When set to `1` (default in Playwright), Next.js API routes use an in-memory Convex mock instead of a real Convex backend.
  - Unset or set to `0` to require a real Convex dev server for tests that hit Convex.
- PERSIST_ASSESSMENTS_SECRET
  - Service-to-service bearer token used by the Convex persistence finalize endpoint.
  - Injected consistently into the Next.js server env and Playwright test env in `ui/playwright.config.ts`.
  - In mock mode (`MOCK_CONVEX=1`), the finalize route skips Authorization enforcement to avoid 401s during tests.

## Local E2E run
- Web servers (spawned by Playwright; see `ui/playwright.config.ts`):
  - FastAPI (uvicorn): `http://127.0.0.1:8000`
  - Next.js: `http://localhost:3100` with fresh server per run (`reuseExistingServer=false`)
- Key environment variables:
  - `CSS_TRANSFORMER_WASM=1` (forces Lightning CSS WASM path)
  - `AI_API_BASE_URL=http://127.0.0.1:8000`
  - `MOCK_CONVEX=1` for in-memory Convex
  - `PERSIST_ASSESSMENTS_SECRET=<any-dev-secret>`
  - If using real Convex: `MOCK_CONVEX=0`, `CONVEX_URL`, `NEXT_PUBLIC_CONVEX_URL`
- Example run (from `ui/`):
  - Install deps: `npm ci`
  - Run all E2E: `npx playwright test`
  - Run specific: `npx playwright test tests/e2e/api.contract.messages.ingest.spec.ts`

## Troubleshooting
- 401 Unauthorized on `POST /api/assessments/convex/finalize`
  - Ensure `MOCK_CONVEX=1` (auth skipped in mock mode) or provide `Authorization: Bearer $PERSIST_ASSESSMENTS_SECRET` matching server env.
- `latestGroupId` is null during ingestion tests
  - Ensure you are on the latest AI API where placeholders are persisted on `start/continue`, and that `GET /assessments/{sessionId}` is called with a decoded `sessionId` (supports raw+decoded lookup).

## AI API: Metrics & Persistence

### Metrics endpoint (Prometheus)
- Path: `GET /metrics`
- Media type: Prometheus exposition format (`text/plain; version=0.0.4`)
- Example scrape:

```bash
curl -s http://127.0.0.1:8000/metrics | head -n 40
```

Emitted metrics:
- `coachup_sqs_send_seconds` — Histogram: SQS `send_message` duration
- `coachup_sqs_receive_seconds` — Histogram: SQS `receive_message` duration
- `coachup_sqs_delete_seconds` — Histogram: SQS `delete_message` duration
- `coachup_sqs_change_visibility_seconds` — Histogram: SQS `change_message_visibility` duration
- `coachup_sqs_messages_enqueued_total{status="ok|error"}` — Counter
- `coachup_sqs_messages_polled_total{outcome="empty|messages|error"}` — Counter
- `coachup_sqs_messages_deleted_total{status="ok|error"}` — Counter
- `coachup_sqs_visibility_changes_total{status="ok|error"}` — Counter
- `coachup_assessment_job_seconds` — Histogram: assessment job durations
- `coachup_assessments_enqueue_latency_seconds` — Histogram: enqueue→dequeue latency
- `coachup_assessments_retries_total` — Counter: retry attempts
- `coachup_assessments_jobs_total{status="success|failed"}` — Counter: job outcomes
- `coachup_assessments_queue_depth{provider="memory"}` — Gauge: in-memory queue depth

Notes:
- If `prometheus-client` is not installed, `/metrics` returns `503 metrics unavailable`.
- SQS queue depth is not scraped directly; use AWS CloudWatch (ApproximateNumberOfMessages*). The in-memory provider exposes depth via `coachup_assessments_queue_depth{provider="memory"}`.

### Assessment persistence callback
- Controlled by environment variables in the AI API:
  - `PERSIST_ASSESSMENTS_URL` — when set, AI API posts finalized summaries to this URL
  - `PERSIST_ASSESSMENTS_SECRET` — if set, added as `Authorization: Bearer <secret>`
- Headers sent by the AI API:
  - `Content-Type: application/json`
  - `Authorization: Bearer $PERSIST_ASSESSMENTS_SECRET` (when configured)
  - `X-Request-Id` (when present on the incoming request)
- Payload shape (expanded; matches Next.js finalize route expectations):

```json
{
  "sessionId": "sess_123",
  "groupId": "grp_abc",
  "rubricVersion": "v1",
  "summary": {
    "highlights": ["..."],
    "recommendations": ["..."],
    "categories": ["correctness", "clarity", "conciseness", "fluency"],
    "scores": { "correctness": 0.9, "clarity": 0.8, "conciseness": 0.7, "fluency": 0.85 },
    "meta": { "messageCount": 4, "durationMs": 12345, "slice": { "startIndex": 0, "endIndex": 3 } },
    "rubricVersion": "v1",
    "rubricKeyPoints": ["correctness:0.9", "clarity:0.8", "conciseness:0.7", "fluency:0.85"]
  }
}
```

## AI API: SQS durable queue (optional)

- __Feature flag__: `USE_SQS` (default `0`). When `1`, the AI API uses Amazon SQS FIFO as its durable queue; otherwise it uses the in-memory queue.
- __Environment variables__ (set in `coach-up-ai-api/.env`):
  - `USE_SQS=0|1`
  - `AWS_REGION=us-east-1`
  - `AWS_SQS_QUEUE_URL=https://.../coach-up-assessments.fifo` (must end with `.fifo`)
  - `AWS_ENDPOINT_URL_SQS` (optional; e.g. `http://localhost:4566` for LocalStack)
  - `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (required for AWS or LocalStack)

### Local development with LocalStack

1) Start LocalStack and create a FIFO queue:

```bash
awslocal --endpoint-url=http://localhost:4566 \
  sqs create-queue \
  --queue-name coach-up-assessments.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true
```

2) Configure the AI API `.env`:

```bash
USE_SQS=1
AWS_REGION=us-east-1
AWS_SQS_QUEUE_URL=http://localhost:4566/000000000000/coach-up-assessments.fifo
AWS_ENDPOINT_URL_SQS=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
```

3) Run the servers normally; the AI API worker will long-poll SQS.

### Tests note

- The AI API includes SQS adapter tests. They are skipped if `boto3`/`botocore` are not installed.
- Skip reason shown by pytest: “SQS tests require boto3. Install with: `python -m pip install -r requirements.txt`”.
- To run SQS tests locally:

```bash
cd coach-up-ai-api
python -m pip install -r requirements.txt
pytest -q
```
