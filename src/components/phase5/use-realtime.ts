'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

interface RealtimeState {
  connected: boolean;
  authed: boolean;
  lastEvent: { event: string; payload: unknown; ts: number } | null;
}

/**
 * Connects to the realtime mini-service via socket.io, authenticates with the
 * shop-owner JWT, and listens for shop-channel events. The dashboard's queue
 * refreshes whenever an event arrives — true push, no polling.
 *
 * The connection is best-effort: if the mini-service is down, `connected`
 * stays false and the caller falls back to polling. (Caddy forwards
 * `/?XTransformPort=3003` → the mini-service.)
 */
export function useRealtime(token: string | null, onEvent: (event: string, payload: unknown) => void): RealtimeState {
  const [state, setState] = useState<RealtimeState>({ connected: false, authed: false, lastEvent: null });
  const onEventRef = useRef(onEvent);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  useEffect(() => {
    if (!token) return;
    const socket: Socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1500,
      timeout: 8000,
    });

    socket.on('connect', () => {
      setState((s) => ({ ...s, connected: true }));
      socket.emit('auth', { token });
    });
    socket.on('disconnect', () => setState((s) => ({ ...s, connected: false, authed: false })));
    socket.on('auth-ok', () => setState((s) => ({ ...s, authed: true })));
    socket.on('auth-error', () => socket.disconnect());

    // Device-integration events: job.failed/job.needs_review update print
    // state; device.* events come from the device-management surface
    // (revoke/disable/command issuance); delivery.received fires when a
    // companion confirms file receipt; sync.pushed/order.cancelled close the
    // publish/subscribe gap found in the Phase A verification (published by
    // the backend but never subscribed). order.collected was removed —
    // nothing in the backend publishes it. All are push-refresh triggers —
    // the authenticated REST APIs remain the source of truth.
    const events = [
      'order.paid',
      'order.ready',
      'order.cancelled',
      'job.printing',
      'job.completed',
      'job.failed',
      'job.needs_review',
      'job.dispatch',
      'sync.pushed',
      'device.revoked',
      'device.command.issued',
      'device.token_rotated',
      'agent.revoked',
      'agent.heartbeat',
      'delivery.received',
    ];
    for (const ev of events) {
      socket.on(ev, (payload: unknown) => {
        setState((s) => ({ ...s, lastEvent: { event: ev, payload, ts: Date.now() } }));
        onEventRef.current(ev, payload);
      });
    }

    return () => { socket.disconnect(); };
  }, [token]);

  return state;
}
