import { defineConfig, devices } from '@playwright/test';

const skipContracts = /^(1|true)$/i.test(process.env.SKIP_AI_CONTRACTS ?? '');
// Ensure a consistent bearer for finalize endpoint across server and tests
const persistSecret = process.env.PERSIST_ASSESSMENTS_SECRET || 'test-secret';
process.env.PERSIST_ASSESSMENTS_SECRET = persistSecret;

// Build UI web server env without clobbering .env.local values.
// Only pass Convex envs when explicitly provided to Playwright.
const uiWebServerEnv: Record<string, string> = {
  PORT: process.env.PORT || '3100',
  CSS_TRANSFORMER_WASM: '1',
  AI_API_BASE_URL: 'http://127.0.0.1:8001',
  MOCK_CONVEX: process.env.MOCK_CONVEX ?? '1',
  PERSIST_ASSESSMENTS_SECRET: persistSecret,
};
if (process.env.CONVEX_URL) {
  uiWebServerEnv.CONVEX_URL = process.env.CONVEX_URL;
}
if (process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL) {
  uiWebServerEnv.NEXT_PUBLIC_CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL!;
}

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3100',
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium:real-convex', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    ...(skipContracts ? [] : [{
      // FastAPI (AI API) — run via uvicorn
      command: 'python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8001',
      url: 'http://127.0.0.1:8001/health',
      reuseExistingServer: false,
      timeout: 120_000,
      cwd: '../../coach-up-ai-api',
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
    }]),
    {
      // Next.js UI
      command: 'npm run dev:wasm',
      url: process.env.BASE_URL || 'http://localhost:3100',
      reuseExistingServer: false,
      timeout: 120_000,
      env: uiWebServerEnv,
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
    },
  ],
});
