import type { EmailAdapter, EmailMessage } from '@platform/core/interfaces';

/** Captures sent emails into an array — for tests and local dev. */
export class StubEmailAdapter implements EmailAdapter {
  readonly provider = 'stub';
  public sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<{ messageId: string }> {
    this.sent.push(message);
    return { messageId: crypto.randomUUID() };
  }
}
