import type { SMSAdapter, SmsMessage } from '@platform/core/interfaces';

/** Captures sent SMS into an array — SMS is stubbed in the MVP. */
export class StubSmsAdapter implements SMSAdapter {
  readonly provider = 'stub';
  public sent: SmsMessage[] = [];

  async send(message: SmsMessage): Promise<{ messageId: string }> {
    this.sent.push(message);
    return { messageId: crypto.randomUUID() };
  }
}
