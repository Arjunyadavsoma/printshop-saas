import type { RealtimeAdapter, Subscription } from '@platform/core/interfaces';

/**
 * Socket.io relay concrete for the {@link RealtimeAdapter} interface.
 *
 * `publish` POSTs `{ channel, event, payload }` to the realtime mini-service's
 * `/emit` HTTP relay (default http://127.0.0.1:3004), which broadcasts to every
 * connected dashboard in the shop room. Best-effort: a down relay is logged
 * and swallowed — the DB updates that triggered the publish still land.
 *
 * Swapping the in-memory realtime for this relay is a one-line
 * `REALTIME_PROVIDER=socketio` change in the composition root.
 */
export class SocketIoRelayRealtimeAdapter implements RealtimeAdapter {
  readonly provider = 'socketio-relay';

  constructor(
    private readonly config: { emitUrl: string; emitSecret: string },
    private readonly log?: (msg: string, ctx?: Record<string, unknown>) => void,
  ) {}

  async publish(channel: string, event: string, payload: unknown): Promise<number> {
    try {
      const res = await fetch(this.config.emitUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-emit-secret': this.config.emitSecret,
        },
        body: JSON.stringify({ channel, event, payload }),
        // Don't hang the request flow if the relay is slow.
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) this.log?.('realtime relay non-ok', { status: res.status, channel, event });
      return 1;
    } catch (err) {
      this.log?.('realtime relay publish failed', { channel, event, err: String(err) });
      return 0;
    }
  }

  /**
   * Browser dashboards subscribe via the socket.io CLIENT, not through this
   * server-side adapter. So subscribe() here is a no-op stub (the adapter is
   * publish-only in this process; the mini-service owns the fan-out).
   */
  async subscribe(): Promise<Subscription> {
    return { unsubscribe: async () => {} };
  }

  async presenceCount(): Promise<number> {
    return 0;
  }
}
