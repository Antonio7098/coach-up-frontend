export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { promRegistry } from "../lib/metrics";

export async function GET() {
  const body = await promRegistry.metrics();
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
