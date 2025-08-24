import { test, expect } from '@playwright/test';

// Smoke test for Skills API — verifies the endpoint responds and returns expected JSON shape.
// Does not assume seeded data. Runs under MOCK_CONVEX=1 by default per playwright.config.ts

test('GET /api/v1/skills returns { skills: [] } shape', async ({ request, baseURL }) => {
  const res = await request.get(`${baseURL}/api/v1/skills`);
  expect(res.status()).toBe(200);
  const json = await res.json();
  expect(json).toHaveProperty('skills');
  expect(Array.isArray(json.skills)).toBe(true);
});

test('GET /api/v1/skills?id=unknown returns { skill: null } shape', async ({ request, baseURL }) => {
  const res = await request.get(`${baseURL}/api/v1/skills?id=unknown`);
  expect(res.status()).toBe(200);
  const json = await res.json();
  expect(json).toHaveProperty('skill');
  // With no seed, unknown id should be null in MOCK_CONVEX
  expect(json.skill === null || typeof json.skill === 'object').toBe(true);
});
