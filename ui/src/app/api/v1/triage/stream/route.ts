export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { getBus } from '../../../lib/events';
import { devLog } from '../../../lib/observability';

function sseFormat(ev: any) {
  return `event: event\ndata: ${JSON.stringify(ev)}\n\n`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId') || '';
  devLog("info", "triage:stream: GET request initiated", { sessionId });

  if (!sessionId) {
    devLog("warn", "triage:stream: Missing sessionId", { sessionId });
    return new Response('sessionId required', { status: 400 });
  }

  // Set a reasonable timeout for triage streams (5 minutes)
  // Triage operations shouldn't take longer than this
  const STREAM_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  devLog("debug", "triage:stream: Stream timeout set", { timeoutMs: STREAM_TIMEOUT_MS });

  const stream = new ReadableStream({
    start(controller) {
      const bus = getBus('triage', sessionId);
      const onEvent = (ev: any) => {
        devLog("debug", "triage:stream: Event received", { sessionId, eventType: ev.type });
        try { controller.enqueue(new TextEncoder().encode(sseFormat(ev))); } catch {}
      };

      // Send connected event
      onEvent({ type: 'connected', sessionId });

      // Set up heartbeat
      const hb = setInterval(() => {
        try { controller.enqueue(new TextEncoder().encode(`: hb ${Date.now()}\n\n`)); } catch {}
      }, 15000);

      // Set up stream timeout
      const timeout = setTimeout(() => {
        try {
          onEvent({ type: 'stream_timeout', sessionId });
          controller.close();
        } catch {}
      }, STREAM_TIMEOUT_MS);

      // Listen for triage events
      bus.on('event', onEvent);

      const cancel = () => {
        try {
          clearInterval(hb);
          clearTimeout(timeout);
        } catch {}
        bus.off('event', onEvent);
      };

      (request.signal as any).addEventListener?.('abort', cancel);
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    }
  });
}

