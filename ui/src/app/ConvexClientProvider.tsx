"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useMemo } from "react";
import { devLog } from "./api/lib/observability";

export default function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;

  devLog("debug", "ConvexClientProvider: initializing", {
    hasUrl: !!url,
    url: url ? "[REDACTED]" : undefined
  });

  const client = useMemo(() => {
    if (!url) {
      if (typeof window !== "undefined") {
        devLog("error", "ConvexClientProvider: NEXT_PUBLIC_CONVEX_URL is not set", { url: process.env.NEXT_PUBLIC_CONVEX_URL });
      }
      // Create a dummy client to satisfy provider; without URL Convex will not work.
      // It's better to surface a clear console error than crash the whole app here.
    }
    return new ConvexReactClient(url as string);
  }, [url]);

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
