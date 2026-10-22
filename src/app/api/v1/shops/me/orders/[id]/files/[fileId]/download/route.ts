import { NextResponse, type NextRequest } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { getContainer } from '@/lib/container';
import { fail, toAppError } from '@/lib/api/envelope';
import { NotFoundError, ValidationError } from '@platform/core/errors';

/**
 * GET /api/v1/shops/me/orders/:id/files/:fileId/download
 *
 * Shopkeeper-scoped secure download. Verifies the bearer JWT, resolves the
 * shop by owner, looks up the order (tenant-scoped), then the file
 * (order-scoped), and streams the bytes from the storage adapter with the
 * correct Content-Type + a Content-Disposition attachment header so the
 * browser downloads it with the original filename.
 *
 * In production (R2/S3) the storage adapter's getBytes() may be a streaming
 * proxy; either way the bytes travel through the app server ONLY when the
 * shopkeeper wants to manually fetch a print-ready file (e.g. when the agent
 * is offline). For agent-driven downloads, the presigned URL is used.
 */
export const GET = withAuth<{ id: string; fileId: string }>(
  async (req: NextRequest, ctx, principal) => {
    try {
      const { id, fileId } = await ctx.params;
      const shop = await repos.shops.getByOwner(principal.userId);
      const order = await repos.orders.findByIdAndShop(id, shop.id);
      if (!order) throw new NotFoundError('Order not found');

      const files = await repos.files.findByOrder(order.id);
      const file = files.find((f) => f.id === fileId);
      if (!file) throw new NotFoundError('File not found in this order');

      // Once an order is collected, files are deleted from storage (privacy).
      if (order.status === 'collected' || order.status === 'cancelled') {
        throw new ValidationError(
          `Order in status '${order.status}' — files have been removed from storage`,
        );
      }

      const storage = getContainer().storage;
      const getter = storage as unknown as {
        getBytes?: (k: string) => Promise<{ bytes: Uint8Array; contentType: string } | null>;
      };
      if (typeof getter.getBytes !== 'function') {
        return fail(toAppError(new Error('storage backend does not support direct get')));
      }
      const obj = await getter.getBytes(file.storageKey);
      if (!obj) {
        return NextResponse.json(
          { success: false, error: { code: 'NOT_FOUND', message: 'object not found in storage' } },
          { status: 404 },
        );
      }

      // Force a download with the original filename (preserve the extension).
      const safeName = file.originalFilename.replace(/[^\w.\-]+/g, '_');
      return new NextResponse(obj.bytes as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': obj.contentType || file.mimeType || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${safeName}"`,
          'Cache-Control': 'no-store',
        },
      });
    } catch (cause) {
      return fail(toAppError(cause));
    }
  },
);
