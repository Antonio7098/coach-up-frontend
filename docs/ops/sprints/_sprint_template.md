# Sprint SPR-XXX — <Sprint Name>

Short 1–2 sentence summary of the sprint purpose and expected outcome.

## Meta
- Sprint ID: SPR-XXX
- Status: planned | active | done | canceled
- Start date: <YYYY-MM-DD>
- End date: <YYYY-MM-DD>
- Links: [Overview](./overview.md) · [PRD](../../planning/prd.md) · [Technical Overview](../../planning/technical-overview.md) · [Monitoring](../../ops/monitoring.md) · [Benchmarking](../../ops/benchmarking.md) · [Features CSV](../features.csv)

## Objectives (Tick when achieved)
- [ ] Objective 1
- [ ] Objective 2
- [ ] Objective 3

## Planned Tasks
- [ ] Task 1 — <owner> (<estimate>)
   - [ ] Subtask 1
   - [ ] Subtask 2
   - [ ] Subtask 3
- [ ] Task 2 — <owner> (<estimate>)
   - [ ] Subtask 1
- [ ] Task 3 — <owner> (<estimate>)
   - [ ] Subtask 1
   - [ ] Subtask 2

## Scope
In scope
- Bullet 1
- Bullet 2

Out of scope
- Bullet A
- Bullet B

## Features in this Sprint
List feature IDs from Features CSV (pipe-separate multiple)
- [ ] FEAT-XXX — <feature name> (area)
- [ ] FEAT-YYY — <feature name> (area)

## Acceptance Criteria
- [ ] Criteria 1 (what must be true to ship)
- [ ] Criteria 2
- [ ] Criteria 3

## Risks & Mitigations
- Risk: <description> · Mitigation: <plan>
- Risk: <description> · Mitigation: <plan>

## Dependencies
- Depends on features/sprints: <FEAT-### / SPR-###>
- External: <API/service/approval>

## Technical Details
### Database Models
- Collections/Tables impacted: <User|Session|Interaction|Assessment|TrackedSkill|...>
- New/changed fields: <model.field: type/notes>
- Constraints/validation: <required/enum/range>
- Indexes (read/write paths): <model: [field,...]>
- Migrations: <id or link> — Backfill plan: <steps or NA>
- Data retention: <e.g., raw audio 7d, logs 30d>

### Algorithmic Details
- Approach: <e.g., minimal-edit correction; EMA-based level mapping>
- Rubric Version: <v1>
- Latency targets: TTFT < 1.2s; full-turn < 2.5s

### Prompts & Rubrics
- Prompt names/links: <chat, correction, summary>
- Judge/rubric key points: <clarity, minimality, tone>

## QA & Testing
- [ ] Unit tests updated/added
- [ ] E2E happy path green (Playwright)
- [ ] Load/SSE smoke test passes (k6)
- [ ] Contract tests for API routes

## Observability & SLOs
Targets (see Technical Overview §10)
- Realtime chat p95 TTFT < 1.2s; full-turn < 2.5s
- Assessment p95 completion < 8s

Checkpoints
- [ ] Dashboards exist/updated (links)
- [ ] Alerts configured (links)
- [ ] Structured logs include requestId, provider, modelId, tokens, cost, latency

## Issues & Deviations
Use this section to log issues encountered during the sprint, how they were resolved, and any deviations from the plan.

- Date: <YYYY-MM-DD> — Issue: <short summary> — Impact: <scope/users/services>
  - Detection: <alert/log/user report>
  - Fix: <what changed> — PR: <link> — Owner: <name>
  - Follow-up: <test/monitoring/doc action>
- Deviation from plan: <what changed and why>

## Operational Hygiene
- [ ] CI checks green (API Docs workflow, tests/linting)
- [ ] Branch protection respected (PR + review)
- [ ] Pre-commit hooks executed (lint/format/type checks)
- [ ] .env.example updated if new env vars added
- [ ] Request ID propagated end-to-end for changed paths
- [ ] Logs include: requestId, route, userId (if available), provider, modelId, tokens, cost, latency
- [ ] Rate limiting and idempotency considered for new/changed endpoints

## Documentation
- [ ] API reference updated for endpoints touched (Core & AI)
- [ ] OpenAPI spec updated and linted
- [ ] Examples added/verified (curl + TypeScript)
- [ ] Cross-links updated (PRD/Technical Overview)

## Post-sprint
- [ ] KPIs reviewed; compare to targets
- [ ] Retrospective completed; action items filed
- [ ] Docs updated (PRD/Tech Overview/Runbooks)

## Change Log
- <YYYY-MM-DD> Created sprint page
- <YYYY-MM-DD> Updated scope
- <YYYY-MM-DD> Moved FEAT-XXX to SPR-YYY
