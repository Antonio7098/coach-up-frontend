# Shared API Headers & Conventions

## Auth
- Authorization: Bearer <Clerk JWT> (Core API)
- Service auth (Core → AI): JWT verification (issuer/audience) or shared secret for background workers

## Request ID
- X-Request-Id: stable per client request; propagate client → Next.js → FastAPI → provider

## Tracked Skill (privacy-preserving)
- X-Tracked-Skill-Id: optional; raw tracked skill identifier provided by the client.
  - The server hashes this value (SHA-256) and only the hash (`trackedSkillIdHash`) is logged/persisted.
  - The raw value is never logged or stored.
  - Use this to correlate assessments and events with a user-selected tracked skill without exposing the underlying ID.
  - Example:
    ```bash
    curl -s \
      -H 'X-Request-Id: req_123' \
      -H 'X-Tracked-Skill-Id: skill_public_speaking' \
      http://localhost:3000/api/assessments/run
    ```

## Content Types
- application/json for REST
- text/event-stream for SSE streaming endpoints

## Rate Limits
- 429 with Retry-After header on limit exceeded
- Suggested headers (document if implemented):
  - X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset

## Tracing
- Include requestId in all logs; optionally include hashed userId/sessionId/trackedSkillId/groupId
