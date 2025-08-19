# Contributing to Coach Up (Frontend)

Thanks for contributing! This repo currently hosts planning and API documentation scaffolding for the Next.js app. Keep changes small and well-scoped.

## Dev setup
- Node 20+
- Make (for convenience)
- Copy `.env.example` to `.env.local` and fill values

## Common tasks
- Lint OpenAPI specs: `make openapi-lint`
- Build API docs (HTML): `make redoc-build`

## PR checklist (Definition of Done)
- [ ] References Sprint (SPR-###) and Features (FEAT-###) in PR description
- [ ] Tests updated/added if code is present (unit/e2e)
- [ ] Observability updated (logs/metrics/alerts) if applicable
- [ ] Documentation updated (PRD/Technical Overview/Runbooks) if applicable
- [ ] API docs updated if endpoints changed (OpenAPI + reference)

## Branching and releases
- Create feature branches from `main`
- Submit PRs for review; `main` is protected and requires checks passing

## Code style
- Use Prettier/ESLint (when app code is present)
- Keep docs concise and actionable

## Request ID & Logging
- Use `X-Request-Id` to correlate logs end-to-end
- See `examples/requestId.ts` for a minimal helper stub
