import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { getContainer } from '@/lib/container';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { NotFoundError, ValidationError } from '@platform/core/errors';

/**
 * GET /api/v1/shops/me/orders/:id/files/:fileId/print-url
 *
 * Generates a SHORT-LIVED (60-second) presigned download URL for a specific
 * order file. Used by the shopkeeper's browser to fetch the PDF bytes +
 * send them to the local PrintLatch agent for printing.
 *
 * SECURITY:
 *   - `withAuth` requires a valid JWT (owner role).
 *   - `repos.shops.getByOwner` enforces shop-scoped access — a shopkeeper
 *     can only generate a print URL for files in THEIR OWN shop's orders.
 *   - `repos.orders.findByIdAndShop` enforces tenant isolation — the order
 *     must belong to the shopkeeper's shop.
 *   - The presigned URL is 60 seconds — short enough that even if it leaks,
 *     it expires before anyone can use it.
 *   - The URL is object-specific (points to the exact file's storage key).
 *   - No service-role credentials are exposed — the presigned URL is a
 *     time-limited token, not a credential.
 *   - Payment status is NOT checked here — the shopkeeper can print any
 *     file in their shop's orders (they may need to print a draft before
 *     payment, or reprint a completed order).
 */
export const GET = withAuth<{ id: string; fileId: string }>(
  async (req, ctx, principal) => {
    try {
      const { id, fileId } = await ctx.params;
      const shop = await repos.shops.getByOwner(principal.userId);
      const order = await repos.orders.findByIdAndShop(id, shop.id);
      if (!order) throw new NotFoundError('Order not found');

      // Verify the file belongs to this order.
      const files = await repos.files.findByOrder(order.id);
      const file = files.find((f) => f.id === fileId);
      if (!file) throw new NotFoundError('File not found in this order');

      // Don't allow printing files from collected/cancelled orders (privacy:
      // files are auto-deleted from storage after collection).
      if (order.status === 'collected' || order.status === 'cancelled') {
        throw new ValidationError(
          `Order in status '${order.status}' — files have been removed from storage`,
        );
      }

      // Generate the short-lived presigned download URL.
      const downloadUrl = await getContainer().storage.getPresignedDownloadUrl(
        file.storageKey,
        60, // 60 seconds — just enough time for the browser to fetch + send to PrintLatch.
      );

      // Audit-log the print URL generation (shopkeeper action).
      await repos.audit.log({
        shopId: shop.id,
        userId: principal.userId,
        action: 'file.print-url',
        entityType: 'file',
        entityId: file.id,
        metadata: { orderId: order.id, filename: file.originalFilename, expiresIn: 60 },
        ip: req.headers.get('x-forwarded-for') ?? null,
      });

      return ok({
        downloadUrl,
        filename: file.originalFilename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        expiresIn: 60,
        // Include the print settings from the file record so the browser
        // can send them to PrintLatch without a second API call.
        copies: file.copies,
        colorMode: file.colorMode,
        duplex: file.duplex,
        paperSize: file.paperSize,
        pageRange: file.pageRange,
      });
    } catch (cause) {
      return fail(toAppError(cause));
    }
  },
  ['owner'],
);
