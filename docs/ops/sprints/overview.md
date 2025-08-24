# Sprint Overview

High-level view of all planned sprints for the MVP.

## Cadence & Conventions
- Cadence: 1-2 days
- Timezone: Europe/London
- Status values: planned | active | done | canceled
- Definition of Done: demoable, tests green (unit/E2E smoke), no P0 bugs, docs updated
- Links: [PRD](../../planning/prd.md) · [Technical Overview](../../planning/technical-overview.md) · [Monitoring](../../ops/monitoring.md) · [Benchmarking](../../ops/benchmarking.md) · [Features CSV](../features.csv)

## Sprint Checklist
Mark a sprint done by ticking its box.

- [x] [SPR-001 — MVP Chat Core](./SPR-001.md) (chat SSE baseline). Features: FEAT-001 | FEAT-002 | FEAT-018
- [ ] [SPR-002 — Assessments v1](./SPR-002.md) (multi‑turn + summary). Features: FEAT-010 | FEAT-011 | FEAT-008 | FEAT-009 | FEAT-028
- [ ] [SPR-003 — Auth & Data](./SPR-003.md) (auth, schema, storage). Features: FEAT-014 | FEAT-024 | FEAT-025 | FEAT-007
- [ ] [SPR-004 — Audio Storage, STT/TTS & Voice Mode](./SPR-004.md) (audio storage + voice mode). Features: FEAT-025 | FEAT-043 | FEAT-044 | FEAT-045 | FEAT-016 | FEAT-048 | FEAT-049
- [ ] [SPR-005 — Monitoring & Guardrails](./SPR-005.md) (metrics, limits, breakers). Features: FEAT-019 | FEAT-020 | FEAT-026 | FEAT-022 | FEAT-023
- [ ] [SPR-006 — Coaching UX & Focus](./SPR-006.md). Features: FEAT-006 | FEAT-012 | FEAT-013 | FEAT-015 | FEAT-016 | FEAT-017
- [ ] [SPR-007 — Provider & Benchmarking](./SPR-007.md). Features: FEAT-004 | FEAT-029 | FEAT-021 | FEAT-022

## Portfolio View (All Planned Sprints)
| sprint_id | name | start_date | end_date | objective | themes | features (IDs) | owners | status |
|---|---|---|---|---|---|---|---|---|
| [SPR-001](./SPR-001.md) | MVP Chat Core | 19/08/2025 | 19/08/2025 | Ship realtime chat SSE baseline | chat, frontend | FEAT-001|FEAT-002|FEAT-018 | <owner(s)> | done |
| [SPR-002](./SPR-002.md) | Assessments v1 | 19/08/2025 | <DD/MM/YYYY> | Multi-turn assessment + summary | ai, backend | FEAT-010|FEAT-011|FEAT-008|FEAT-009|FEAT-028 | <owner(s)> | active |
| [SPR-003](./SPR-003.md) | Auth & Data | <DD/MM/YYYY> |  | Auth, schema, storage | backend, infra | FEAT-014|FEAT-024|FEAT-025|FEAT-007 | <owner(s)> | planned |
| [SPR-004](./SPR-004.md) | Audio Storage, STT/TTS & Voice Mode | 22/08/2025 |  | Audio storage + STT/TTS + voice mode | audio, ai | FEAT-025|FEAT-043|FEAT-044|FEAT-045|FEAT-016|FEAT-048|FEAT-049 | <owner(s)> | active |
| [SPR-005](./SPR-005.md) | Monitoring & Guardrails | <DD/MM/YYYY> |  | Metrics/logs, rate limits, breakers | infra | FEAT-019|FEAT-020|FEAT-026|FEAT-022|FEAT-023 | <owner(s)> | planned |
| [SPR-006](./SPR-006.md) | Coaching UX & Focus | <DD/MM/YYYY> |  | Corrections UI + Tracked Skill + dashboard | frontend, backend | FEAT-006|FEAT-012|FEAT-013|FEAT-015|FEAT-016|FEAT-017 | <owner(s)> | planned |
| [SPR-007](./SPR-007.md) | Provider & Benchmarking | <DD/MM/YYYY> |  | Provider abstraction + benchmarking | ai, infra | FEAT-004|FEAT-029|FEAT-021|FEAT-022 | <owner(s)> | planned |
 

Notes:
- features column uses IDs from Features CSV (pipe-separated for multiple).
- themes: 2–3 keywords to categorize the sprint (e.g., chat, ai, infra).

## Milestones (Cross-Sprint)
- <YYYY-MM-DD> MVP Chat ready for pilot (SPR-001, SPR-003)
- <DD/MM/YYYY> Assessments v1 enabled for 50% users (SPR-002, SPR-006)
- <DD/MM/YYYY> Monitoring SLOs green p95 TTFT/Turn (SPR-005)

## Risks & Dependencies
- Risks: list major risks with owners and mitigations.
- Dependencies: e.g., SPR-002 depends on FEAT-014 (Auth) and FEAT-024 (Schema).

## KPI & SLO Focus
- This cycle: p95 TTFT < 1.2s, full-turn < 2.5s; assessment p95 < 8s
- Success definition: how we’ll judge the cycle outcome.

## Change Log
- <YYYY-MM-DD> Created initial sprint overview
