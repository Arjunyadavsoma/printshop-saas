import { createHash, randomBytes } from 'node:crypto';
import { withAuth, withRateLimit } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { getContainer } from '@/lib/container';
import { ok } from '@/lib/api/envelope';

/**
 * POST /api/v1/companion/pairing/begin — shopkeeper-authed.
 *
 * Mints a single-use, short-lived pairing ticket that the PrintEXE companion
 * app exchanges (via /api/v1/companion/pair) for a long-lived device token.
 *
 * Security model:
 *   - The plaintext ticket is returned ONCE to the authenticated shopkeeper
 *     (never stored). Only its SHA-256 hash is persisted.
 *   - The ticket lives for 5 minutes and can be consumed exactly once.
 *   - Rate-limited to 5 requests/minute per source IP to prevent ticket spam.
 *
 * The shopkeeper hands the ticket to the companion either by clicking a
 * `printshop://pair?ticket=...&shop=...` deep link or by pasting the ticket
 * into the companion's pairing UI.
 */
export const POST = withRateLimit(
  'pairing-begin',
  5,
  60,
  withAuth(async (req, _ctx, principal) => {
    const shop = await repos.shops.getByOwner(principal.userId);

    // 32 random bytes → 64-char hex string. Cryptographically random.
    const ticket = randomBytes(32).toString('hex');
    // Store ONLY the SHA-256 hash — the plaintext ticket is returned to the
    // caller exactly once and never persisted.
    const ticketHash = createHash('sha256').update(ticket).digest('hex');

    const now = Date.now();
    const expiresAt = new Date(now + 5 * 60 * 1000); // 5 minutes

    await getContainer().db.insert('pairingTicket', {
      id: crypto.randomUUID(),
      shopId: shop.id,
      agentId: null, // linked when the companion consumes the ticket
      createdByUserId: principal.userId,
      ticketHash,
      status: 'active', // active | consumed | expired | revoked
      expiresAt,
      consumedAt: null,
      createdAt: new Date(),
      deviceName: null,
      deviceMetadata: null,
    });

    // Best-effort audit — pairing ticket issued. Never log the ticket value.
    await repos.audit.log({
      shopId: shop.id,
      userId: principal.userId,
      action: 'pairing.ticket.issued',
      entityType: 'PairingTicket',
      entityId: ticketHash.slice(0, 12), // opaque, non-reversible prefix
      metadata: { expiresAt: expiresAt.toISOString(), shopId: shop.id },
      ip: req.headers.get('x-forwarded-for') ?? null,
    });

    return ok({
      ticket,
      pairingUrl: `printshop://pair?ticket=${ticket}&shop=${shop.id}`,
      expiresAt: expiresAt.toISOString(),
      shopId: shop.id,
    });
  }, ['owner', 'staff']),
);
