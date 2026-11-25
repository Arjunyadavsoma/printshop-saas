import { describe, expect, it, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { ResendEmailAdapter } from './resend.adapter';

describe('ResendEmailAdapter', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it('sends via the Resend SDK and returns the message id', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_123' }, error: null });
    const adapter = new ResendEmailAdapter('re_test_key');
    expect(adapter.provider).toBe('resend');
    const out = await adapter.send({
      to: 'owner@example.com',
      from: 'no-reply@printelyx.cc.cd',
      subject: 'Reset your Printelyx password',
      text: 'hello',
      html: '<p>hello</p>',
    });
    expect(out).toEqual({ messageId: 'msg_123' });
    expect(sendMock).toHaveBeenCalledWith({
      from: 'no-reply@printelyx.cc.cd',
      to: 'owner@example.com',
      subject: 'Reset your Printelyx password',
      text: 'hello',
      html: '<p>hello</p>',
      replyTo: undefined,
    });
  });

  it('throws a clear error when Resend reports a failure', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'Domain not verified', name: 'validation_error' } });
    const adapter = new ResendEmailAdapter('re_test_key');
    await expect(
      adapter.send({ to: 'a@b.com', from: 'no-reply@printelyx.cc.cd', subject: 'x', text: 'y' }),
    ).rejects.toThrow('Resend send failed: Domain not verified');
  });

  it('refuses to construct without an API key', () => {
    expect(() => new ResendEmailAdapter('')).toThrow('RESEND_API_KEY');
  });
});
