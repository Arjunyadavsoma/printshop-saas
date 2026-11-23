'use client';

/**
 * OrderRealtimeClient — Socket.IO client for live order tracking (P8.5).
 *
 * Connects to the WebSocket mini-service on :3003 via the Caddy gateway
 * (`/?XTransformPort=3003`, path `/`). The 128-bit order token IS the
 * credential: the client emits `auth:order` with the token on connect, the
 * server joins it to room `order:<token>`, and the API broadcasts status +
 * task events into that room via the /emit relay.
 *
 * Reliability features:
 *  - Reconnect with backoff: 1s → 2s → 5s → 10s → 30s (max). After 3 failed
 *    attempts, `onFallback` fires so the host can switch to polling.
 *  - Heartbeat: ping every 25s, expect pong within 10s. A missed pong trips
 *    a reconnect.
 *  - Resume sync: on every (re)connect, fetch GET /api/v1/o/[token] to catch
 *    any events missed while disconnected. The fetched status is routed
 *    through `onStatusChange` (with the same no-duplicate rule).
 *  - No duplicate toasts: the last-seen status is tracked; the callback only
 *    fires when the status actually changes.
 *
 * The class is intentionally framework-agnostic (no React) — the
 * `useOrderRealtime` hook wraps it for the tracking page.
 */

import { io, type Socket } from 'socket.io-client';

/** Reconnect backoff schedule (ms). After the last entry, repeats at the max. */
const RECONNECT_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
/** Reconnect attempts before switching to polling fallback. */
const FALLBACK_AFTER_FAILED_ATTEMPTS = 3;
/** Heartbeat: send ping every 25s, expect pong within 10s. */
const HEARTBEAT_PING_INTERVAL_MS = 25_000;
const HEARTBEAT_PONG_TIMEOUT_MS = 10_000;
/** Order token format: 32+ hex chars (128-bit minimum). */
const ORDER_TOKEN_RE = /^[a-f0-9]{32,128}$/i;

export type StatusChangeCallback = (status: string) => void;
export type TaskUpdateCallback = (task: { setId: string; progress: number }) => void;
export type FallbackCallback = () => void;
export type ReconnectCallback = () => void;

export interface OrderRealtimeClientOptions {
  /** Override the polling fallback fetcher (tests). Defaults to fetch(). */
  fetcher?: typeof fetch;
}

export class OrderRealtimeClient {
  private readonly orderToken: string;
  private readonly fetcher: typeof fetch;
  private socket: Socket | null = null;
  private connected = false;
  private fallbackActive = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSeenStatus: string | null = null;
  private statusCallbacks: Set<StatusChangeCallback> = new Set();
  private taskCallbacks: Set<TaskUpdateCallback> = new Set();
  private fallbackCallbacks: Set<FallbackCallback> = new Set();
  private reconnectCallbacks: Set<ReconnectCallback> = new Set();
  private disposed = false;

  constructor(orderToken: string, opts: OrderRealtimeClientOptions = {}) {
    if (!orderToken || !ORDER_TOKEN_RE.test(orderToken)) {
      throw new Error(`Invalid order token format: ${orderToken.slice(0, 8)}…`);
    }
    this.orderToken = orderToken;
    this.fetcher = opts.fetcher ?? fetch;
  }

  /** Open the socket + join the order room. Idempotent. */
  connect(): void {
    if (this.disposed) return;
    if (this.socket) return;

    // Caddy gateway contract: `/?XTransformPort=3003` and path `/`.
    // socket.io-client parses the namespace from the URL; passing the query
    // in the namespace position is the documented pattern (see the websocket
    // demo in /examples).
    const socket = io('/?XTransformPort=3003', {
      path: '/',
      transports: ['websocket', 'polling'],
      // We drive reconnection ourselves so we can apply the backoff schedule
      // + trip the polling fallback after 3 failures. socket.io's built-in
      // reconnection is disabled; we call `socket.connect()` on each tick.
      reconnection: false,
      autoConnect: false,
      timeout: 10_000,
    });
    this.socket = socket;

    socket.on('connect', () => this.handleConnect());
    socket.on('disconnect', (reason: string) => this.handleDisconnect(reason));
    socket.on('connect_error', () => this.scheduleReconnect());
    socket.on('auth-ok', () => {
      // The server confirmed our order-token join. No-op — `connect` already
      // fired the resume-sync.
    });
    socket.on('auth-error', () => {
      // The server rejected the token. Disconnect + give up (don't spin).
      // socket.io v4: `disconnect()` takes no args; reconnection is already
      // disabled (`reconnection: false`), so this is a clean stop.
      socket.disconnect();
      this.enterFallback();
    });
    socket.on('pong', () => this.handlePong());
    socket.on('order:status', (payload: { status?: string }) => {
      const status = payload?.status;
      if (typeof status === 'string') this.maybeFireStatus(status);
    });
    socket.on('order:task', (payload: { setId?: string; progress?: number }) => {
      if (
        payload &&
        typeof payload.setId === 'string' &&
        typeof payload.progress === 'number'
      ) {
        const task = { setId: payload.setId, progress: payload.progress };
        this.taskCallbacks.forEach((cb) => cb(task));
      }
    });

    socket.connect();
  }

  /** Tear down the socket + all timers. Safe to call multiple times. */
  disconnect(): void {
    this.disposed = true;
    this.clearReconnectTimer();
    this.clearHeartbeat();
    if (this.socket) {
      try {
        this.socket.removeAllListeners();
        this.socket.disconnect();
      } catch {
        /* ignore — socket may already be closed */
      }
      this.socket = null;
    }
    this.connected = false;
  }

  /** Subscribe to status changes (only fires when the status actually changes). */
  onStatusChange(callback: StatusChangeCallback): void {
    this.statusCallbacks.add(callback);
  }

  /** Subscribe to per-task progress updates. */
  onTaskUpdate(callback: TaskUpdateCallback): void {
    this.taskCallbacks.add(callback);
  }

  /** Subscribe to the polling-fallback transition (socket down → polling). */
  onFallback(callback: FallbackCallback): void {
    this.fallbackCallbacks.add(callback);
  }

  /** Subscribe to the post-reconnect sync (host can refresh its data). */
  onReconnectSync(callback: ReconnectCallback): void {
    this.reconnectCallbacks.add(callback);
  }

  /** True when the socket is open + authed. */
  isConnected(): boolean {
    return this.connected && !this.disposed;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private handleConnect(): void {
    this.connected = true;
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    this.startHeartbeat();
    // Join the order room. The server validates the token format + joins.
    this.socket?.emit('auth:order', { orderToken: this.orderToken });
    // Resume sync: fetch the current state to catch events missed while
    // disconnected. The response's status is routed through the same
    // no-duplicate path as socket events.
    void this.resumeSync();
    // If we were in polling-fallback mode, exit it now — the socket is healthy.
    if (this.fallbackActive) this.fallbackActive = false;
  }

  private handleDisconnect(_reason: string): void {
    this.connected = false;
    this.clearHeartbeat();
    if (this.disposed) return;
    this.scheduleReconnect();
  }

  private handlePong(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.connected || !this.socket) return;
      this.socket.emit('ping', { t: Date.now() });
      // Expect a pong within 10s. If it doesn't arrive, the connection is
      // half-open — force a reconnect.
      this.pongTimer = setTimeout(() => {
        if (!this.connected) return;
        // Force reconnect: disconnect + schedule.
        try {
          this.socket?.disconnect();
        } catch {
          /* ignore */
        }
        this.connected = false;
        this.scheduleReconnect();
      }, HEARTBEAT_PONG_TIMEOUT_MS);
    }, HEARTBEAT_PING_INTERVAL_MS);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    if (this.reconnectTimer) return; // already scheduled
    const idx = Math.min(this.reconnectAttempts, RECONNECT_BACKOFF_MS.length - 1);
    const delay = RECONNECT_BACKOFF_MS[idx]!;
    this.reconnectAttempts += 1;

    // After 3 failed attempts, trip the polling fallback (the host will
    // start polling via useTrackPoll). We keep trying to reconnect in the
    // background; when it succeeds, handleConnect() exits the fallback.
    if (this.reconnectAttempts >= FALLBACK_AFTER_FAILED_ATTEMPTS && !this.fallbackActive) {
      this.enterFallback();
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disposed) return;
      if (!this.socket) return;
      try {
        this.socket.connect();
      } catch {
        // connect() threw — schedule another attempt.
        this.scheduleReconnect();
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private enterFallback(): void {
    this.fallbackActive = true;
    this.fallbackCallbacks.forEach((cb) => cb());
  }

  /** Fetch the current order state + route the status through the dedup path. */
  private async resumeSync(): Promise<void> {
    try {
      const res = await this.fetcher(`/api/v1/o/${this.orderToken}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return;
      const d = (await res.json()) as { data?: { order?: { status?: string } } };
      const status = d?.data?.order?.status;
      if (typeof status === 'string') {
        this.maybeFireStatus(status);
      }
      // Tell the host to refresh its full data (price, files, tasks, etc.).
      this.reconnectCallbacks.forEach((cb) => cb());
    } catch {
      // Network error during sync — the next socket event or polling tick
      // will recover. Don't trip the fallback here; the socket is connected.
    }
  }

  /**
   * Fire the status callback ONLY if the status actually changed. This is
   * the "no duplicate toasts" guard: reconnect sync, polling fallback, and
   * live socket events all funnel through here, so a status that hasn't
   * changed never fires twice.
   */
  private maybeFireStatus(status: string): void {
    if (this.lastSeenStatus === status) return;
    this.lastSeenStatus = status;
    this.statusCallbacks.forEach((cb) => cb(status));
  }
}
