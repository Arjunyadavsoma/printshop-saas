/**
 * Realtime fan-out abstraction. The dashboard's order queue and the print
 * agent's job dispatcher both subscribe to channels here.
 *
 * Concrete implementations:
 *  - `SupabaseRealtimeAdapter`   (free 200 concurrent)
 *  - `SocketIoRealtimeAdapter`   (self-hosted, dedicated node)
 *  - `PusherRealtimeAdapter`     (hosted)
 *  - `InMemoryRealtimeAdapter`   (tests / single-process dev)
 */

export type RealtimeHandler = (payload: unknown) => void | Promise<void>;

export interface Subscription {
  /** Stop receiving events for this subscription. */
  unsubscribe(): Promise<void>;
}

export interface RealtimeAdapter {
  readonly provider: string;

  /** Emit an event to a channel. Returns the number of subscribers notified. */
  publish(channel: string, event: string, payload: unknown): Promise<number>;

  /** Listen for an event on a channel. Returns a handle to unsubscribe. */
  subscribe(channel: string, event: string, handler: RealtimeHandler): Promise<Subscription>;

  /** Optional presence: how many subscribers are live on a channel. */
  presenceCount?(channel: string): Promise<number>;
}

/** Channel naming convention — keeps cross-tenant leakage impossible. */
export function shopChannel(shopId: string): string {
  return `shop:${shopId}`;
}
export function agentChannel(agentId: string): string {
  return `agent:${agentId}`;
}
