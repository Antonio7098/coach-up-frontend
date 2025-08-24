import { ConvexHttpClient } from "convex/browser";

export type ConvexCaller = {
  mutation(name: string, args: unknown): Promise<unknown>;
  query(name: string, args: unknown): Promise<unknown>;
};

export const makeConvex = (url: string): ConvexCaller =>
  new ConvexHttpClient(url) as unknown as ConvexCaller;
