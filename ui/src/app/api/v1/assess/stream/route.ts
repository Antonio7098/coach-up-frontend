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
  const requestId = Math.random().toString(36).slice(2);

  devLog('debug', 'Assessment stream initiated', {
    requestId,
    sessionId,
    hasSessionId: !!sessionId,
    timestamp: new Date().toISOString()
  });

  if (!sessionId) {
    devLog('warn', 'Assessment stream request missing sessionId', { requestId });
    return new Response('sessionId required', { status: 400 });
  }

  devLog('info', 'Assessment stream setup started', {
    requestId,
    sessionId,
    setupPhase: 'initializing'
  });

  const stream = new ReadableStream({
    start(controller) {
      devLog('debug', 'Assessment stream controller started', {
        requestId,
        sessionId,
        controllerPhase: 'start'
      });

      const bus = getBus('assess', sessionId);
      const onEvent = (ev: any) => {
        try {
          controller.enqueue(new TextEncoder().encode(sseFormat(ev)));
          devLog('debug', 'Assessment stream event sent', {
            requestId,
            sessionId,
            eventType: ev.type,
            eventData: ev
          });
        } catch (error) {
          devLog('error', 'Assessment stream event send failed', {
            requestId,
            sessionId,
            error: String(error)
          });
        }
      };

      const hb = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(`: hb ${Date.now()}\n\n`));
          devLog('debug', 'Assessment stream heartbeat sent', {
            requestId,
            sessionId,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          devLog('error', 'Assessment stream heartbeat failed', {
            requestId,
            sessionId,
            error: String(error)
          });
        }
      }, 15000);

      bus.on('event', onEvent);

      devLog('info', 'Assessment stream event listener registered', {
        requestId,
        sessionId,
        busEvents: 'listening'
      });

      onEvent({ type: 'connected', sessionId });

      const cancel = () => {
        try { clearInterval(hb); } catch {}
        bus.off('event', onEvent);
        devLog('info', 'Assessment stream cleanup completed', {
          requestId,
          sessionId,
          cleanupPhase: 'complete'
        });
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

