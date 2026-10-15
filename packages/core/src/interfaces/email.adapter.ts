/**
 * Outbound email abstraction. Used for order receipts, low-balance alerts,
 * and onboarding flows.
 *
 * Concrete implementations:
 *  - `ResendEmailAdapter`  (free 3,000/mo)
 *  - `PostmarkEmailAdapter` (roadmap)
 *  - `StubEmailAdapter`    (tests — captures to memory)
 */
export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  /** Plain-text body. */
  text: string;
  /** Optional HTML body. Must be sanitised by the caller if user-influenced. */
  html?: string;
  /** Optional reply-to. */
  replyTo?: string;
}

export interface EmailAdapter {
  readonly provider: string;
  send(message: EmailMessage): Promise<{ messageId: string }>;
}
