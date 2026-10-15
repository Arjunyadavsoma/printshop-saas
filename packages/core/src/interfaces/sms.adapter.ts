/**
 * Outbound SMS abstraction. SMS is **stubbed in the MVP** but the adapter
 * exists so we can slot in MSG91 / Twilio / Gupshup later without touching
 * business logic.
 *
 * Concrete implementations:
 *  - `Msg91SmsAdapter`  (India-focused, DLT-compliant)
 *  - `TwilioSmsAdapter`
 *  - `StubSmsAdapter`    (tests)
 */
export interface SmsMessage {
  to: string; // E.164
  body: string;
  /** DLT template id — mandatory for Indian promotional / transactional SMS. */
  templateId?: string;
}

export interface SMSAdapter {
  readonly provider: string;
  send(message: SmsMessage): Promise<{ messageId: string }>;
}
