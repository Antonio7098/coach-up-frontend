import { EventEmitter } from 'events';
import { devLog } from "./observability";

export type BusEvent =
  | { type: 'connected'; sessionId: string }
  | { type: 'heartbeat'; sessionId: string; ts: number }
  // Triage events
  | { type: 'triage:queued'; sessionId: string }
  | { type: 'triage:start'; sessionId: string; limit?: number; cutoffIndex?: number }
  | { type: 'triage:externalResponse'; sessionId: string; status: number; tookMs?: number }
  | { type: 'triage:updatesPrepared'; sessionId: string; updatesLen: number }
  | { type: 'triage:persistAttempt'; sessionId: string; updatesLen: number }
  | { type: 'triage:persistOk'; sessionId: string; updated: number }
  | { type: 'triage:persistZeroUpdated'; sessionId: string; updatesLen: number }
  | { type: 'triage:persistError'; sessionId: string; error: string }
  | { type: 'triage:done'; sessionId: string }
  | { type: 'triage:error'; sessionId: string; error: string }
  // Assess events
  | { type: 'assess:start'; sessionId: string; groups: number; skills: number }
  | { type: 'assess:finalizeAttempt'; sessionId: string; groupId: string; skills: number }
  | { type: 'assess:finalizeResult'; sessionId: string; groupId: string; status: number }
  | { type: 'assess:done'; sessionId: string; completed: number }
  | { type: 'assess:error'; sessionId: string; error: string };

const buses = new Map<string, EventEmitter>();

export function busKey(topic: 'triage'|'assess', sessionId: string) {
  return `${topic}:${sessionId}`;
}

export function getBus(topic: 'triage'|'assess', sessionId: string): EventEmitter {
  const key = busKey(topic, sessionId);
  let bus = buses.get(key);
  if (!bus) {
    devLog("debug", "events: creating new event bus", { topic, sessionId, busKey: key });
    bus = new EventEmitter();
    bus.setMaxListeners(100);
    buses.set(key, bus);
  } else {
    devLog("debug", "events: reusing existing event bus", { topic, sessionId, busKey: key });
  }
  return bus;
}

export function emitEvent(topic: 'triage'|'assess', sessionId: string, ev: BusEvent) {
  try {
    const bus = getBus(topic, sessionId);
    devLog("debug", "events: emitting event", { topic, sessionId, eventType: ev.type });
    bus.emit('event', ev);
  } catch (error) {
    devLog("error", "events: failed to emit event", { topic, sessionId, eventType: ev.type, error: String(error) });
  }
}

