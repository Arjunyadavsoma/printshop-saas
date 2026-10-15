/**
 * Background-job queue abstraction. Used for: page-count parsing after
 * upload, the 24h file-deletion privacy cron, and dispatching print jobs to
 * agents.
 *
 * Concrete implementations:
 *  - `UpstashQueueAdapter` (QStash — serverless, cron-friendly)
 *  - `BullMqQueueAdapter`  (self-hosted Redis)
 *  - `InMemoryQueueAdapter` (tests / single-process dev)
 */
export interface QueueAdapter {
  readonly provider: string;

  /** Enqueue a job to run ASAP. Returns the job id. */
  enqueue<T>(queue: string, payload: T): Promise<string>;

  /** Schedule a job to run at a future instant. */
  schedule<T>(queue: string, payload: T, runAt: Date): Promise<string>;

  /** Register a handler. Implementations MUST dedupe by `queue`. */
  process<T>(queue: string, handler: (payload: T) => Promise<void>): Promise<void>;
}
