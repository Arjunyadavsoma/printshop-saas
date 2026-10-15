import type { RealtimeAdapter, RealtimeHandler, Subscription } from '@platform/core/interfaces';

/** In-memory pub/sub — only useful within a single process. */
export class InMemoryRealtimeAdapter implements RealtimeAdapter {
  readonly provider = 'memory';
  private channels = new Map<string, Map<string, Set<RealtimeHandler>>>();

  async publish(channel: string, event: string, payload: unknown): Promise<number> {
    const events = this.channels.get(channel);
    if (!events) return 0;
    const handlers = events.get(event);
    if (!handlers) return 0;
    let n = 0;
    for (const h of handlers) {
      await h(payload);
      n++;
    }
    return n;
  }

  async subscribe(channel: string, event: string, handler: RealtimeHandler): Promise<Subscription> {
    let events = this.channels.get(channel);
    if (!events) {
      events = new Map();
      this.channels.set(channel, events);
    }
    let handlers = events.get(event);
    if (!handlers) {
      handlers = new Set();
      events.set(event, handlers);
    }
    handlers.add(handler);
    return {
      unsubscribe: async () => {
        handlers?.delete(handler);
      },
    };
  }

  async presenceCount(channel: string): Promise<number> {
    const events = this.channels.get(channel);
    if (!events) return 0;
    let n = 0;
    for (const handlers of events.values()) n += handlers.size;
    return n;
  }
}
