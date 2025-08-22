# Core API (Next.js) — Reference

Overview of product/domain endpoints exposed via Next.js API routes.

## Conventions
- Base URL: /api/v1
- Auth: Authorization: Bearer <Clerk JWT>
- Request ID: X-Request-Id
- Tracked Skill: X-Tracked-Skill-Id (optional). The server hashes this value (SHA-256) and only the hash (`trackedSkillIdHash`) is logged/persisted.
- Content-Type: application/json (unless SSE)

## Endpoints (MVP)

### POST /api/v1/chat/stream
- Summary: Proxy to AI for streaming chat; relays SSE to client.
- Auth: required
- Headers: X-Request-Id, Accept: text/event-stream
- Body: { "message": string, "sessionId": string }
- Response: text/event-stream
- Notes: Emits data: and done events; see Observability for fields.

### POST /api/v1/assessments/trigger
- Summary: Enqueue multi-turn assessment for a recent interaction buffer.
- Auth: required
- Body: { "sessionId": string, "groupHint?": string }
- Response: { "status": "queued", "groupId": string }

### GET /api/v1/sessions/:id
- Summary: Fetch session details and recent interactions.
- Auth: required

### POST /api/v1/sessions/state
- Summary: Create or update minimal session state in Convex.
- Auth: required
- Headers: X-Request-Id (optional)
- Body:
  ```json
  {
    "userId": "clerk_123",
    "sessionId": "sess_123",
    "state": { "phase": "active" },
    "latestGroupId": "grp_abc"
  }
  ```
- curl example:
  ```bash
  curl -s -X POST \
    -H 'content-type: application/json' \
    --data-binary '{
      "userId":"clerk_123",
      "sessionId":"sess_123",
      "state":{"phase":"active"},
      "latestGroupId":"grp_abc"
    }' \
    http://localhost:3000/api/v1/sessions/state
  ```

### POST /api/v1/interactions
- Summary: Persist a user/AI turn to Convex.
- Auth: required
 - Headers: X-Request-Id (optional), X-Tracked-Skill-Id (optional; hashed-only persistence)
 - Body:
   ```json
   {
     "sessionId": "sess_123",
     "groupId": "grp_abc",
     "messageId": "msg_001",
     "role": "user",
     "contentHash": "sha256:...",
     "audioUrl": "https://.../object.wav",
     "ts": 1692612345678
   }
   ```
 - curl example:
   ```bash
   curl -s -X POST \
     -H 'content-type: application/json' \
     -H 'X-Request-Id: req_123' \
     -H 'X-Tracked-Skill-Id: skill_public_speaking' \
     --data-binary '{
       "sessionId":"sess_123",
       "groupId":"grp_abc",
       "messageId":"msg_001",
       "role":"user",
       "contentHash":"sha256:abc...",
       "ts":1692612345678
     }' \
     http://localhost:3000/api/v1/interactions
   ```

### GET /api/v1/skills
- Summary: List active Skills or fetch a single Skill by id.
- Auth: none (public)
- Query:
  - `id` (string, optional) — when provided, returns `{ "skill": Skill | null }`
  - `category` (string, optional) — when provided (and no `id`), returns `{ "skills": Skill[] }` filtered by category
  - When neither is provided, returns `{ "skills": Skill[] }` of active Skills only
- 400 when `id` is present but empty. 502 on backend errors.
- curl examples:
  - All active
    ```bash
    curl -s http://localhost:3000/api/v1/skills | jq
    ```
  - By id
    ```bash
    curl -s 'http://localhost:3000/api/v1/skills?id=clarity_eloquence' | jq
    ```
  - By category
    ```bash
    curl -s 'http://localhost:3000/api/v1/skills?category=communication' | jq
    ```
- Notes:
  - In local E2E runs, `MOCK_CONVEX=1` serves data from an in-memory mock; production queries Convex functions.
  - The response shape differs when `id` is used vs not used (`skill` vs `skills`).

 - TypeScript example:
   ```ts
   // Minimal example handling both list and single responses
   async function getSkills(baseUrl = 'http://localhost:3000') {
     const res = await fetch(`${baseUrl}/api/v1/skills`);
     if (!res.ok) throw new Error(`HTTP ${res.status}`);
     const body = await res.json();
     if ('skills' in body && Array.isArray(body.skills)) {
       return body.skills; // Skill[]
     }
     if ('skill' in body) {
       return body.skill ? [body.skill] : [];
     }
     throw new Error('Unexpected response shape');
   }

   async function getSkillById(id: string, baseUrl = 'http://localhost:3000') {
     const res = await fetch(`${baseUrl}/api/v1/skills?id=${encodeURIComponent(id)}`);
     if (!res.ok) throw new Error(`HTTP ${res.status}`);
     const body = await res.json();
     return 'skill' in body ? body.skill : null;
   }
   ```

## Assessments (Convex-backed)
- POST `/api/assessments/run` — proxies AI API to start an assessment job; also persists Convex baseline (mocked when `MOCK_CONVEX=1`).
- GET  `/api/assessments/[sessionId]` — proxies AI API to fetch latest summary for a session.
- POST `/api/assessments/convex/finalize` — persists summary document to Convex (mock when `MOCK_CONVEX=1`).
- GET  `/api/assessments/convex/[sessionId]` — fetches latest Convex summary/baseline for a session.

Notes:
- See E2E toggles in `docs/api/README.md#e2e-toggles` for `SKIP_AI_CONTRACTS` and `MOCK_CONVEX` behavior during tests.

## OpenAPI Spec
- Generated from Zod schemas using zod-to-openapi.
- File: docs/api/core/openapi.json (run generator script in repo once available).

## Changelog
- 2025-08-19: Initial stub added.
