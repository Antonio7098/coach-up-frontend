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
- x-tracked-skill-id: active trackedSkillId (if applicable, hash allowed).
- x-group-id: multi-turn evaluation groupId (when present, hash allowed).
- traceparent: W3C Trace Context (if you adopt OpenTelemetry later).
- x-provider: logical provider key (e.g., openai, deepgram) used for this request.
- x-model-id: model name (e.g., gpt-4o-mini).

SSE/Streaming
- accept: text/event-stream for SSE endpoints.
- cache-control: no-store for interactive endpoints.

PII & security
- Never propagate raw PII in headers. Use hashed IDs for user/session/trackedSkill/group.
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
- userIdHash, sessionIdHash, trackedSkillIdHash, groupId: hashed identifiers

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
- Include requestId on every event; include user/session/trackedSkill/group hashes where relevant.

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
  "trackedSkillIdHash": "ts:aa31…",
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
  "trackedSkillIdHash": "ts:aa31…",
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
  "function": "assessments.query",
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

### Assessment worker log events (FastAPI)

These are emitted by `coach-up-ai-api` in `app/main.py` during background assessment processing.

1) Dequeue
```json
{
  "event": "assessments_dequeue",
  "requestId": "r-123",
  "sessionId": "s-abc",
  "groupId": "g-xyz",
  "workerIndex": 0,
  "queueDepth": 2
}
```

2) Retry with backoff
```json
{
  "event": "assessments_retry",
  "requestId": "r-123",
  "sessionId": "s-abc",
  "groupId": "g-xyz",
  "attempt": 2,
  "backoff_ms": 800
}
```

3) Job start
```json
{
  "event": "assessments_job_start",
  "requestId": "r-123",
  "sessionId": "s-abc",
  "groupId": "g-xyz",
  "rubricVersion": "v1"
}
```

4) Scores
```json
{
  "event": "assessments_scores",
  "requestId": "r-123",
  "sessionId": "s-abc",
  "groupId": "g-xyz",
  "rubricVersion": "v1",
  "scores": { "correctness": 0.71, "clarity": 0.62, "conciseness": 0.55, "fluency": 0.77 }
}
```

5) Job complete
```json
{
  "event": "assessments_job_complete",
  "requestId": "r-123",
  "sessionId": "s-abc",
  "groupId": "g-xyz",
  "rubricVersion": "v1",
  "total_ms": 430
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

## 6) What to watch (ops quick list)

- Queue depth: sustained growth in `assessments_dequeue.queueDepth` indicates backlog.
- Latency: p95 of `assessments_job_complete.total_ms` per rubricVersion.
- Retries: rate of `assessments_retry.attempt > 1`; alert if spikes.
- Next.js SSE: `chat_stream_first_token.ttft_ms` and `chat_stream_complete.total_ms`.

## 7) SQS + Worker Alerts (Prometheus examples)

The AI API (`coach-up-ai-api/app/main.py`) exposes Prometheus metrics for SQS operations and assessment workers:

- SQS API latency histograms: `coachup_sqs_send_seconds`, `coachup_sqs_receive_seconds`, `coachup_sqs_delete_seconds`, `coachup_sqs_change_visibility_seconds`
- SQS counters: `coachup_sqs_messages_enqueued_total{status}`, `coachup_sqs_messages_polled_total{outcome}`, `coachup_sqs_messages_deleted_total{status}`, `coachup_sqs_visibility_changes_total{status}`
- Worker metrics: `coachup_assessment_job_seconds` (histogram), `coachup_assessments_enqueue_latency_seconds` (histogram), `coachup_assessments_retries_total`, `coachup_assessments_jobs_total{status}`

Example Prometheus alerting rules (tune thresholds per env):

```yaml
groups:
  - name: coachup-ai-api
    rules:
      # 1) Job failure rate
      - alert: CoachUpAssessmentsFailureRateHigh
        expr: |
          rate(coachup_assessments_jobs_total{status="failure"}[5m])
            /
          clamp_min(rate(coachup_assessments_jobs_total[5m]), 1e-9) > 0.2
        for: 10m
        labels:
          severity: page
          service: py
        annotations:
          summary: "+20% assessment job failures"
          description: |
            Failure rate exceeded 20% over 10m.

      # 2) Retry spike (exponential backoff loop engaged)
      - alert: CoachUpAssessmentsRetriesSpike
        expr: rate(coachup_assessments_retries_total[5m]) > 5
        for: 10m
        labels:
          severity: warn
          service: py
        annotations:
          summary: "Assessment retries elevated"
          description: "Sustained retries > 5/min over 10m. Investigate upstream/provider stability."

      # 3) SQS send errors
      - alert: CoachUpSQSSendErrors
        expr: increase(coachup_sqs_messages_enqueued_total{status="error"}[5m]) > 0
        for: 5m
        labels:
          severity: page
          service: py
        annotations:
          summary: "SQS send_message errors occurring"
          description: "Messages failing to enqueue to SQS. Check AWS creds/endpoint/permissions and LocalStack health."

      # 4) SQS delete errors (post-processing)
      - alert: CoachUpSQSDeleteErrors
        expr: increase(coachup_sqs_messages_deleted_total{status="error"}[5m]) > 0
        for: 5m
        labels:
          severity: page
          service: py
        annotations:
          summary: "SQS delete_message errors occurring"
          description: "Processed messages not getting deleted. Risk of reprocessing."

      # 5) SQS visibility change errors (backoff path)
      - alert: CoachUpSQSVisibilityErrors
        expr: increase(coachup_sqs_visibility_changes_total{status="error"}[10m]) > 0
        for: 10m
        labels:
          severity: warn
          service: py
        annotations:
          summary: "SQS change_message_visibility errors"
          description: "Worker backoff may be failing; messages can immediately retry and thrash."

      # 6) P95 enqueue latency from enqueue->dequeue too high
      - alert: CoachUpAssessmentsEnqueueP95High
        expr: >
          histogram_quantile(
            0.95,
            sum by (le) (rate(coachup_assessments_enqueue_latency_seconds_bucket[5m]))
          ) > 5
        for: 10m
        labels:
          severity: warn
          service: py
        annotations:
          summary: "Assessment enqueue->dequeue p95 > 5s"
          description: "Backlog growing or workers under-provisioned."

      # 7) P95 job duration too high
      - alert: CoachUpAssessmentsJobP95High
        expr: >
          histogram_quantile(
            0.95,
            sum by (le) (rate(coachup_assessment_job_seconds_bucket[5m]))
          ) > 10
        for: 15m
        labels:
          severity: warn
          service: py
        annotations:
          summary: "Assessment job p95 > 10s"
          description: "Worker logic or upstream providers are slow; check logs and provider latencies."
```

Notes
- `coachup_assessments_queue_depth` only reflects in-memory provider; it is not meaningful when `USE_SQS=1`.
- Consider overlaying deployment labels (env, service) in Prometheus relabeling and Grafana dashboards.

## 8) DLQ Redrive Runbook (SQS FIFO)

Goal: safely move messages from DLQ back to the main FIFO queue after fixing the underlying issue.

Pre-checks
- Ensure the root cause is mitigated (bug fix, capacity, provider outage recovered).
- Pause producers if reprocessing could duplicate side-effects.
- Test with a small batch first.

Commands (LocalStack via `awslocal`)

```bash
export AWS_REGION=us-east-1
export AWS_ENDPOINT_URL_SQS=http://localhost:4566

MAIN=coach-up-assessments.fifo
DLQ=coach-up-assessments-dlq.fifo

MAIN_URL=$(awslocal sqs get-queue-url --queue-name "$MAIN" --query 'QueueUrl' --output text)
DLQ_URL=$(awslocal sqs get-queue-url --queue-name "$DLQ" --query 'QueueUrl' --output text)

# Inspect DLQ depth
awslocal sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible --output json

# Preview one DLQ message (requires jq)
MSG=$(awslocal sqs receive-message --queue-url "$DLQ_URL" --max-number-of-messages 1 --visibility-timeout 30 --wait-time-seconds 0 --output json)
echo "$MSG" | jq '.'

# Redrive one message back to main (preserve FIFO grouping)
BODY=$(echo "$MSG" | jq -r '.Messages[0].Body')
RECEIPT=$(echo "$MSG" | jq -r '.Messages[0].ReceiptHandle')
GROUP=$(echo "$BODY" | jq -r .sessionId)
DEDUP=$(echo "$BODY" | jq -r '.sessionId + ":" + .groupId')
awslocal sqs send-message --queue-url "$MAIN_URL" --message-body "$BODY" --message-group-id "$GROUP" --message-deduplication-id "$DEDUP"
awslocal sqs delete-message --queue-url "$DLQ_URL" --receipt-handle "$RECEIPT"

# Batch redrive (up to 10 at a time) – iterate until DLQ empty
while true; do
  BATCH=$(awslocal sqs receive-message --queue-url "$DLQ_URL" --max-number-of-messages 10 --visibility-timeout 60 --wait-time-seconds 0 --output json)
  COUNT=$(echo "$BATCH" | jq -r '.Messages | length // 0')
  [ "$COUNT" = "0" ] && break
  for i in $(seq 0 $((COUNT-1))); do
    BODY=$(echo "$BATCH" | jq -r ".Messages[$i].Body")
    RECEIPT=$(echo "$BATCH" | jq -r ".Messages[$i].ReceiptHandle")
    GROUP=$(echo "$BODY" | jq -r .sessionId)
    DEDUP=$(echo "$BODY" | jq -r '.sessionId + ":" + .groupId')
    awslocal sqs send-message --queue-url "$MAIN_URL" --message-body "$BODY" --message-group-id "$GROUP" --message-deduplication-id "$DEDUP"
    awslocal sqs delete-message --queue-url "$DLQ_URL" --receipt-handle "$RECEIPT"
  done
done
```

Cloud (aws CLI) differences
- Replace `awslocal` with `aws` and set `--region` (and omit `--endpoint-url`).
- Required IAM permissions: `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:SendMessage`, `sqs:GetQueueAttributes`.

Post-actions
- Monitor alerts/dashboards for failure rate and retry spikes during redrive.
- Once stable, reduce alert noise thresholds if they were temporarily relaxed.
