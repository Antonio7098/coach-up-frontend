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
