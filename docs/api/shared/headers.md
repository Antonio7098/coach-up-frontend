# Shared API Headers & Conventions

## Auth
- Authorization: Bearer <Clerk JWT> (Core API)
- Service auth (Core → AI): JWT verification (issuer/audience) or shared secret for background workers

## Request ID
- X-Request-Id: stable per client request; propagate client → Next.js → FastAPI → provider

## Content Types
- application/json for REST
- text/event-stream for SSE streaming endpoints

## Rate Limits
- 429 with Retry-After header on limit exceeded
- Suggested headers (document if implemented):
  - X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset

## Tracing
- Include requestId in all logs; optionally include hashed userId/sessionId/focusId/groupId
