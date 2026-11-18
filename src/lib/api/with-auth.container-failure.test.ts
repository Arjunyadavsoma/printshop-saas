import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { withAuth, withDeviceAuth } from './with-auth';

/**
 * Regression test — production 500 incident (2026-11-18).
 *
 * ROOT CAUSE of the live outage: the merged branch made buildContainer()
 * fail-fast in production on DEVICE_TOKEN_PEPPER (container.ts:375,
 * device-token.ts assertDeviceTokenPepperConfigured). When the deployment
 * lacked that env var, getContainer() threw on EVERY API request.
 *
 * withRateLimit already acquired the container inside its try/catch, so
 * those routes answered with the standard JSON error envelope
 * (`{"success":false,"error":{"code":"INTERNAL_ERROR",...}}`, HTTP 500).
 * withAuth and withDeviceAuth acquired it OUTSIDE their try/catch, so the
 * same failure escaped the wrapper and surfaced as a bare empty-body 500
 * (reports/daily, sync/status) — inconsistent, and invisible to clients
 * that parse the envelope.
 *
 * FIX: both wrappers now acquire the container inside their try block, so a
 * container-build failure returns the same JSON envelope (HTTP 500) with the
 * x-request-id header, and normal operation is unchanged.
 */

const mockState = vi.hoisted(() => ({
  shouldThrow: true,
}));

vi.mock('@/lib/container', () => ({
  getContainer: () => {
    if (mockState.shouldThrow) {
      throw new Error(
        'FATAL: DEVICE_TOKEN_PEPPER must be set to at least 16 characters in production.',
      );
    }
    // Minimal working container for the control path: a token that fails
    // verification yields the normal 401 UNAUTHORIZED envelope.
    return {
      auth: { verifyAccessToken: async () => null },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    };
  },
}));

vi.mock('@/lib/repositories', () => ({
  repos: {},
}));

const REQ = () => new NextRequest('http://localhost:3000/api/v1/shops/me/jobs');

describe('withAuth / withDeviceAuth — container-build failure (env misconfig)', () => {
  beforeEach(() => {
    mockState.shouldThrow = true;
  });

  it('withAuth returns the JSON 500 error envelope (not a thrown error)', async () => {
    const handler = withAuth(async () => {
      throw new Error('handler must never be reached');
    });
    const res = await handler(REQ(), { params: Promise.resolve({}) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('withDeviceAuth returns the JSON 500 error envelope (not a thrown error)', async () => {
    const handler = withDeviceAuth(async () => {
      throw new Error('handler must never be reached');
    });
    const res = await handler(REQ(), { params: Promise.resolve({}) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    // NOTE: unlike withAuth, the device-auth catch intentionally does not
    // set x-request-id (pre-existing behavior, unchanged by this fix).
  });

  describe('when the container builds normally', () => {
    beforeEach(() => {
      mockState.shouldThrow = false;
    });

    it('withAuth still returns the normal 401 envelope for a bad token', async () => {
      const handler = withAuth(async () => {
        throw new Error('handler must never be reached');
      });
      const res = await handler(REQ(), { params: Promise.resolve({}) });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });
});
