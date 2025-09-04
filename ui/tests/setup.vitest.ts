import { vi } from 'vitest';

// Mock ConvexHttpClient globally for unit tests
vi.mock('convex/browser', () => {
  const instances: any[] = [];
  const behavior: any = { queryReturn: undefined, queryThrow: null, mutationReturn: undefined, mutationThrow: null };
  (globalThis as any).__convexMockBehavior = behavior;
  class ConvexHttpClientMock {
    url: string;
    query = vi.fn((..._args: any[]) => {
      if ((globalThis as any).__convexMockBehavior?.queryThrow) {
        return Promise.reject((globalThis as any).__convexMockBehavior.queryThrow);
      }
      return Promise.resolve((globalThis as any).__convexMockBehavior?.queryReturn);
    });
    mutation = vi.fn((..._args: any[]) => {
      if ((globalThis as any).__convexMockBehavior?.mutationThrow) {
        return Promise.reject((globalThis as any).__convexMockBehavior.mutationThrow);
      }
      return Promise.resolve((globalThis as any).__convexMockBehavior?.mutationReturn);
    });
    constructor(url: string) {
      this.url = url;
      instances.push(this);
    }
  }
  // Expose for tests to access the latest instance
  (globalThis as any).__convexMockInstances = instances;
  return { ConvexHttpClient: ConvexHttpClientMock };
});

// Mock Convex server codegen so convex/functions/* can be imported in unit tests without codegen
vi.mock('../_generated/server', () => {
  const passthrough = (def: any) => def;
  return {
    mutation: passthrough,
    query: passthrough,
  };
});

// Helper to get the latest Convex client instance
export function getLatestConvexClientMock(): any | undefined {
  const arr = (globalThis as any).__convexMockInstances as any[] | undefined;
  return arr && arr[arr.length - 1];
}

export function setConvexMockBehavior(partial: {
  queryReturn?: any;
  queryThrow?: any;
  mutationReturn?: any;
  mutationThrow?: any;
}) {
  const b = (globalThis as any).__convexMockBehavior || {};
  Object.assign(b, partial);
  (globalThis as any).__convexMockBehavior = b;
}

// Mock Clerk server auth to avoid server-only import issues in unit tests.
// Default unauthenticated; tests can flip CLERK_ENABLED as needed.
vi.mock('@clerk/nextjs/server', () => {
  return {
    auth: async () => ({ userId: null }),
  };
});

// Tests can opt into MOCK_CONVEX=1 per-spec when they want to use the in-memory store.
