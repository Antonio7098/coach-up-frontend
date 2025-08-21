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
        throw (globalThis as any).__convexMockBehavior.queryThrow;
      }
      return (globalThis as any).__convexMockBehavior?.queryReturn;
    });
    mutation = vi.fn((..._args: any[]) => {
      if ((globalThis as any).__convexMockBehavior?.mutationThrow) {
        throw (globalThis as any).__convexMockBehavior.mutationThrow;
      }
      return (globalThis as any).__convexMockBehavior?.mutationReturn;
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
