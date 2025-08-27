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
   - Notes:
     - `groupId` is optional. When omitted, the interaction is persisted by `sessionId` alone.
     - `role` must be `user` or `assistant`.
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
  - Without groupId (session-only persistence):
    ```bash
    curl -s -X POST \
      -H 'content-type: application/json' \
      -H 'X-Request-Id: req_123' \
      --data-binary '{
        "sessionId":"sess_123",
        "messageId":"msg_002",
        "role":"assistant",
        "contentHash":"sha256:def...",
        "ts":1692612346000
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

## Storage (Audio)

### POST /api/v1/storage/audio/presign
- Summary: Generate a presigned PUT URL to upload audio objects.
- Auth: required (Clerk JWT)
- Headers: `X-Request-Id` (optional)
- Body:
  ```json
  {
    "contentType": "audio/webm|audio/wav|audio/mpeg|audio/mp4|audio/x-m4a",
    "filename": "optional_name.ext",
    "sizeBytes": 123456
  }
  ```
- Response:
  ```json
  {
    "url": "https://s3.local/object-key?signature=...",
    "method": "PUT",
    "headers": { "Content-Type": "audio/webm" },
    "expiresAt": 1692712345678,
    "objectKey": "audio/2025-08-22/abcd.webm",
    "contentType": "audio/webm"
  }
  ```
- curl example:
  ```bash
  curl -s -X POST \
    -H 'authorization: Bearer <JWT>' \
    -H 'content-type: application/json' \
    --data-binary '{
      "contentType":"audio/webm",
      "filename":"utterance.webm",
      "sizeBytes": 102400
    }' \
    http://localhost:3000/api/v1/storage/audio/presign | jq
  ```

 - TypeScript example:
  ```ts
  import { ensureRequestId } from '../../examples/requestId'

   async function presign(baseUrl = 'http://localhost:3000', jwt?: string) {
     const headers: Record<string, string> = { 'content-type': 'application/json' }
     if (jwt) headers['authorization'] = `Bearer ${jwt}`
     const { headers: h } = ensureRequestId(headers)
     const res = await fetch(`${baseUrl}/api/v1/storage/audio/presign`, {
       method: 'POST',
       headers: h,
       body: JSON.stringify({ contentType: 'audio/webm', filename: 'utterance.webm', sizeBytes: 102400 })
     })
     if (!res.ok) throw new Error(`HTTP ${res.status}`)
     return res.json()
  }
  ```

 - Note: The presigned URL expires in approximately 15 minutes. Use it immediately after obtaining it.

## Transcripts

### GET /api/v1/transcripts
- Summary: List transcripts by `sessionId` (and optionally filter by `groupId`).
- Auth: required (Clerk JWT)
- Query:
  - `sessionId` (string, required)
  - `groupId` (string, optional)
  - `limit` (int, optional; default 20, max 100)
  - `cursor` (string, optional)
- Response:
  ```json
  {
    "items": [
      {
        "id": "tr_001",
        "sessionId": "sess_123",
        "groupId": "grp_abc",
        "text": "Hello world",
        "audioUrl": "https://storage/.../utterance.webm",
        "createdAt": 1692712000000
      }
    ],
    "nextCursor": "opaque-cursor"
  }
  ```
- curl example:
  ```bash
  curl -s \
    -H 'authorization: Bearer <JWT>' \
    'http://localhost:3000/api/v1/transcripts?sessionId=sess_123&limit=20' | jq
  ```

 - TypeScript example:
   ```ts
   import { ensureRequestId } from '../../examples/requestId'

   async function listTranscripts(sessionId: string, baseUrl = 'http://localhost:3000', jwt?: string) {
    const headers: Record<string, string> = {}
    if (jwt) headers['authorization'] = `Bearer ${jwt}`
    const { headers: h } = ensureRequestId(headers)
    const url = `${baseUrl}/api/v1/transcripts?sessionId=${encodeURIComponent(sessionId)}&limit=20`
    const res = await fetch(url, { headers: h })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }
  ```

## Speech (STT/TTS)

### Provider selection
- Providers are selected via environment variables (server-side):
  - `STT_PROVIDER` — `mock` (default) or `openai`
  - `TTS_PROVIDER` — `mock` (default) or `openai`
  - `SPEECH_PROFILE` — optional unified fallback for both STT and TTS when the specific vars above are unset (e.g., `openai`)
  - `ALLOW_PROVIDER_OVERRIDE` — when set to `1`, requests may include a body field `{"provider":"mock"|"openai"}` to override per-request
- OpenAI-specific variables:
  - `OPENAI_API_KEY` — required for `openai` providers
  - `OPENAI_STT_MODEL` — default `whisper-1`
  - `OPENAI_TTS_MODEL` — default `gpt-4o-mini-tts`
  - `TTS_VOICE_ID` — default `alloy` (can be overridden per request)
- Storage (S3) used for:
  - STT when body provides `objectKey`
  - TTS upload of synthesized audio (optional; falls back to data URL when absent)

### POST /api/v1/stt
- **Summary**: Transcribe an uploaded audio clip (mock provider in dev by default).
- **Auth**: optional (Clerk-gated when `CLERK_ENABLED=1`)
- **Headers**: `Content-Type: application/json` or `multipart/form-data`, `X-Request-Id` (optional)
- **Body**:
  ```json
  {
    "provider": "mock",
    "audioUrl": "https://example.com/audio/mock.wav",
    "objectKey": "audio/2025-08-22/abcd.webm",
    "sessionId": "sess_123",
    "groupId": "grp_abc",
    "languageHint": "en"
  }
  ```
  - Provide either `audioUrl` or `objectKey`. `sessionId`/`groupId` optional for persistence.
  - `languageHint` is optional and can help the provider with language detection (e.g., `"en"`).
  - `provider` is optional and only honored when `ALLOW_PROVIDER_OVERRIDE=1`. Precedence: request provider > `STT_PROVIDER` > `SPEECH_PROFILE` > `mock`.
- **Response**:
  ```json
  {
    "provider": "mock",
    "text": "mock transcript for: https://example.com/audio/mock.wav",
    "confidence": 0.92,
    "language": "en",
    "sessionId": "sess_123",
    "groupId": "grp_abc",
    "audioUrl": "https://example.com/audio/mock.wav",
    "objectKey": null
  }
  ```
- **curl**:
  ```bash
  curl -s -X POST \
    -H 'content-type: application/json' \
    --data-binary '{
      "audioUrl":"https://example.com/audio/mock.wav",
      "sessionId":"sess_local",
      "groupId":"grp_local"
    }' \
    http://localhost:3000/api/v1/stt | jq
  ```
  - Provider override (requires `ALLOW_PROVIDER_OVERRIDE=1`):
  ```bash
  # override to openai (will return 501 without OPENAI_API_KEY)
  curl -s -X POST \
    -H 'content-type: application/json' \
    --data-binary '{
      "provider":"openai",
      "objectKey":"audio/2025-08-23/sample.wav",
      "sessionId":"sess_local",
      "groupId":"grp_local"
    }' \
    http://localhost:3000/api/v1/stt | jq
  
  # explicitly choose mock regardless of env
  curl -s -X POST \
    -H 'content-type: application/json' \
    --data-binary '{
      "provider":"mock",
      "audioUrl":"https://example.com/audio/mock.wav"
    }' \
    http://localhost:3000/api/v1/stt | jq
  ```
- **Notes**:
  - Emits metrics with labels `{route:"/api/v1/stt", method:"POST", status, mode}` where `mode` is provider (e.g., `mock`).
  - Structured logs include `route`, `requestId`, `status`, `latencyMs`.
  - Returns **501** when the selected provider is not configured (e.g., `OPENAI_API_KEY` missing for `openai`).
  - With `STT_PROVIDER=openai` and `objectKey` provided, the server fetches the object via S3 settings before calling OpenAI Whisper.

#### Multipart upload (direct file)
- **Summary**: Upload audio directly as `multipart/form-data` using the `audio` form field. The server validates, stores to S3, then transcribes via the selected provider.
- **Form fields**:
  - `audio` (file, required) — types: `audio/webm`, `audio/wav`, `audio/mpeg`, `audio/mp4`, `audio/x-m4a`
  - `sessionId` (string, optional) — enables transcript persistence
  - `groupId` (string, optional) — groups related utterances
  - `provider` (string, optional) — honored only when `ALLOW_PROVIDER_OVERRIDE=1`
  - `languageHint` (string, optional) — hint such as `en`
- **Behavior**:
  - 400 when `audio` is missing or content type unsupported
  - 413 when file size exceeds `STT_MAX_AUDIO_BYTES` (default 25MB)
  - 501 when storage is not configured for multipart (requires `STORAGE_PROVIDER=s3` and `S3_BUCKET_AUDIO`)
- **curl**:
  ```bash
  curl -s -X POST \
    -H 'x-request-id: req_123' \
    -F 'audio=@/path/to/clip.webm;type=audio/webm' \
    -F 'sessionId=sess_local' \
    -F 'groupId=grp_local' \
    http://localhost:3000/api/v1/stt | jq
  ```
- **TypeScript (browser)**:
  ```ts
  async function transcribeMultipart(file: File, baseUrl = 'http://localhost:3000') {
    const fd = new FormData();
    fd.append('audio', file, file.name);
    fd.append('sessionId', 'sess_local');
    fd.append('groupId', 'grp_local');
    const res = await fetch(`${baseUrl}/api/v1/stt`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  ```
- **Env notes**:
  - `STT_MAX_AUDIO_BYTES` — max upload size; default 25MB. Exceeding returns 413.
  - Storage required for multipart: `STORAGE_PROVIDER=s3`, `S3_BUCKET_AUDIO`, `S3_REGION`, optional `S3_ENDPOINT_URL`, `S3_FORCE_PATH_STYLE=1` for LocalStack.
  - Local dev example (LocalStack): see `ui/.env.local` and `.env.example` for defaults.

### POST /api/v1/tts
- **Summary**: Synthesize short text into an audio clip (mock provider in dev by default).
- **Auth**: optional (Clerk-gated when `CLERK_ENABLED=1`)
- **Headers**: `Content-Type: application/json`, `X-Request-Id` (optional)
- **Body**:
  ```json
  {
    "provider": "mock",
    "text": "Hello from CoachUp mock TTS.",
    "voiceId": "voice_mock",
    "format": "audio/mpeg",
    "sessionId": "sess_123",
    "groupId": "grp_abc"
  }
  ```
  - `provider` is optional and only honored when `ALLOW_PROVIDER_OVERRIDE=1`. Precedence: request provider > `TTS_PROVIDER` > `SPEECH_PROFILE` > `mock`.
- **Response**:
  ```json
  {
    "provider": "mock",
    "text": "Hello from CoachUp mock TTS.",
    "voiceId": "voice_mock",
    "format": "audio/mpeg",
    "sessionId": "sess_123",
    "groupId": "grp_abc",
    "audioUrl": "https://example.com/tts/mock/Hello%20from%20CoachUp%20mock%20.mp3",
    "note": "mock provider — no real audio produced"
  }
  ```
- **curl**:
  ```bash
  curl -s -X POST \
    -H 'content-type: application/json' \
    --data-binary '{
      "text":"Hello from CoachUp mock TTS.",
      "sessionId":"sess_local",
      "groupId":"grp_local"
    }' \
    http://localhost:3000/api/v1/tts | jq
  ```
  - Provider override (requires `ALLOW_PROVIDER_OVERRIDE=1`):
  ```bash
  # override to openai (will return 501 without OPENAI_API_KEY)
  curl -s -X POST \
    -H 'content-type: application/json' \
    --data-binary '{
      "provider":"openai",
      "text":"Hello from OpenAI TTS",
      "format":"audio/mpeg"
    }' \
    http://localhost:3000/api/v1/tts | jq

  # explicitly choose mock regardless of env
  curl -s -X POST \
    -H 'content-type: application/json' \
    --data-binary '{
      "provider":"mock",
      "text":"Hello from mock TTS"
    }' \
    http://localhost:3000/api/v1/tts | jq
  ```
- **Notes**:
  - Emits metrics with labels `{route:"/api/v1/tts", method:"POST", status, mode}`.
  - Structured logs include `route`, `requestId`, `status`, `latencyMs`.
  - Returns **501** when the selected provider is not configured (e.g., `OPENAI_API_KEY` missing for `openai`).
  - With `TTS_PROVIDER=openai`, the server synthesizes audio via OpenAI. If S3 is configured, the audio is uploaded and the response `audioUrl` points to your bucket (or LocalStack endpoint). Otherwise, a `data:` URL is returned.

## OpenAPI Spec
- Generated from Zod schemas using zod-to-openapi.
- File: docs/api/core/openapi.json (run generator script in repo once available).

## Changelog
- 2025-08-19: Initial stub added.
