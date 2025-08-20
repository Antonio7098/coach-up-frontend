This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Real Convex Quickstart

Use a real Convex dev deployment instead of mocks.

1) Env (create `ui/.env.local`):

```bash
MOCK_CONVEX=0
# Cloud dev deployment URL
CONVEX_URL=https://<your-dev>.convex.cloud
NEXT_PUBLIC_CONVEX_URL=https://<your-dev>.convex.cloud
# Local AI API
AI_API_BASE_URL=http://127.0.0.1:8001
NEXT_PUBLIC_AI_API_BASE_URL=http://127.0.0.1:8001
```

2) Start Convex (from `coach-up-frontend/`):

```bash
# Watch & push code to your dev deployment
npx convex dev

# Or do a one-off deploy
npx convex deploy --deployment dev:<project-slug>
```

3) Start services:

```bash
# Terminal A (AI API)
python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --app-dir ../../coach-up-ai-api

# Terminal B (UI)
npm run dev:wasm
```

4) E2E tests against real Convex:

```bash
# Uses the Playwright project "chromium:real-convex"
# Set CONVEX_URL if not present in .env.local
CONVEX_URL=https://<your-dev>.convex.cloud npm run test:e2e:real-convex
```

Notes:
- Convex CLI writes your dev deployment name to `.env.local` as `CONVEX_DEPLOYMENT` when you run `npx convex dev`. Do not commit `.env.local` (it is gitignored).
- Use your Convex dashboard dev URL for `CONVEX_URL`/`NEXT_PUBLIC_CONVEX_URL`. Commit your Convex source under `convex/`, but exclude generated artifacts (e.g., `convex/_generated/`) and `.convex/` (both are gitignored).
- Playwright will pass through `CONVEX_URL`/`NEXT_PUBLIC_CONVEX_URL` to the Next.js dev server.

## SSR-safe random values (hydration-safe pattern)

Never generate random values (e.g., IDs) at module scope or during SSR for components rendered on both server and client. Doing so can cause hydration mismatches because the server HTML differs from the client render.

Pattern used in `ui/src/app/chat/page.tsx`:

- Generate the value only on the client inside `useEffect`.
- Store it in component state and persist to `sessionStorage` for stability across reloads.
- Gate UI actions until the value is ready and show a brief placeholder.

Example:

```tsx
// Inside a Client Component
const [sessionId, setSessionId] = useState("");
useEffect(() => {
  const existing = typeof window !== 'undefined' ? window.sessionStorage.getItem('chatSessionId') : null;
  if (existing) {
    setSessionId(existing);
    return;
  }
  const id = (globalThis as any).crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  setSessionId(id);
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem('chatSessionId', id);
  }
}, []);
```

This prevents SSR/client divergence and avoids React hydration warnings.
