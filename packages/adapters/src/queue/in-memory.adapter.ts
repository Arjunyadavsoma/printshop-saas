import type { QueueAdapter } from '@platform/core/interfaces';

/** In-memory queue — processes jobs immediately on enqueue (tests only). */
export class InMemoryQueueAdapter implements QueueAdapter {
  readonly provider = 'memory';
  private handlers = new Map<string, (payload: unknown) => Promise<void>>();
  /** Captured job ids — handy for asserting in tests. */
  public enqueued: { id: string; queue: string; payload: unknown; runAt: Date }[] = [];

  async enqueue<T>(queue: string, payload: T): Promise<string> {
    const id = crypto.randomUUID();
    this.enqueued.push({ id, queue, payload, runAt: new Date() });
    // Dispatch asynchronously (setTimeout 0) so enqueue returns immediately,
    // matching real queue semantics — the producer isn't blocked by the
    // consumer, and the handler's state transitions happen in their own turn.
    setTimeout(() => void this.dispatch(queue, payload).catch(() => {}), 0);
    return id;
  }

  async schedule<T>(queue: string, payload: T, runAt: Date): Promise<string> {
    const id = crypto.randomUUID();
    this.enqueued.push({ id, queue, payload, runAt });
    const delayMs = Math.max(0, runAt.getTime() - Date.now());
    setTimeout(() => void this.dispatch(queue, payload).catch(() => {}), delayMs);
    return id;
  }

  async process<T>(queue: string, handler: (payload: T) => Promise<void>): Promise<void> {
    this.handlers.set(queue, handler as (payload: unknown) => Promise<void>);
  }

  private async dispatch(queue: string, payload: unknown): Promise<void> {
    const h = this.handlers.get(queue);
    if (h) await h(payload);
  }
}
