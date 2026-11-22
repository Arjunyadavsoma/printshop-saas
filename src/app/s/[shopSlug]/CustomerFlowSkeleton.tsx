import { SkeletonBox, SkeletonText } from '@/components/customer/skeleton';

/**
 * CustomerFlowSkeleton — the placeholder shown by `next/dynamic` while the
 * real `CustomerOrderFlowV2` client bundle is loading.
 *
 * The shop landing (`src/app/s/[shopSlug]/page.tsx`) is a Server Component
 * that ships the AppBar + live status line + rate-board in the initial HTML,
 * but the heavy upload/options/payment flow is wrapped in `dynamic(...,
 * { ssr: false })` so the ~80 KB client component code is split out of the
 * shop landing's initial JS bundle. While that chunk downloads + hydrates,
 * this skeleton fills the same vertical space so the customer sees a stable
 * page rather than a flash of empty content.
 *
 * Shape mirrors `CustomerOrderFlowV2`'s step-0 layout:
 *   - Stepper row (3 dots + labels)
 *   - Upload dropzone (dashed border, large)
 *   - File-card placeholder (one row, so the swap-in is invisible if the
 *     customer lands with a draft in IndexedDB that hydrates a single card)
 *   - StickyActionBar skeleton at the bottom
 *
 * `aria-hidden` — the skeleton is decoration for sighted users; a
 * screen-reader user hears the server-rendered copy ("N printers online…")
 * until the real flow mounts.
 */
export function CustomerFlowSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      {/* Stepper skeleton — three pill slots with the first highlighted. */}
      <div className="flex items-center gap-2">
        <SkeletonBox width={72} height={28} radius="9999px" />
        <SkeletonBox width={72} height={28} radius="9999px" />
        <SkeletonBox width={72} height={28} radius="9999px" />
      </div>

      {/* Upload dropzone skeleton — large dashed area. */}
      <div className="rounded-[var(--radius-soft)] border-2 border-dashed border-[var(--color-border-ink-strong)] bg-[var(--color-surface)] p-8">
        <div className="flex flex-col items-center gap-3">
          <SkeletonBox width={48} height={48} radius="9999px" />
          <SkeletonText lines={1} width="short" />
          <SkeletonText lines={1} width="medium" />
        </div>
      </div>

      {/* One file-card skeleton — keeps layout stable if a draft hydrates. */}
      <div className="rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] p-3">
        <div className="flex items-center gap-3">
          <SkeletonBox width={56} height={56} radius="var(--radius-tight)" />
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <SkeletonText lines={1} width="medium" />
            <SkeletonText lines={1} width="short" />
          </div>
        </div>
      </div>

      {/* Preset row skeleton — four cards like the real step-0 presets. */}
      <div className="grid grid-cols-2 gap-2">
        <SkeletonBox height={120} radius="var(--radius-default)" />
        <SkeletonBox height={120} radius="var(--radius-default)" />
        <SkeletonBox height={120} radius="var(--radius-default)" />
        <SkeletonBox height={120} radius="var(--radius-default)" />
      </div>

      {/* StickyActionBar skeleton — fixed at the bottom, same chrome. */}
      <div className="sticky bottom-0 z-10 bg-[var(--color-surface)] border-t border-[var(--color-border-ink)] safe-bottom-bar">
        <div className="flex items-center gap-4 px-4 py-3">
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <SkeletonText lines={1} width="short" />
            <SkeletonBox width={64} height={20} radius="var(--radius-tight)" />
          </div>
          <SkeletonBox width={120} height={48} radius="var(--radius-default)" />
        </div>
      </div>
    </div>
  );
}

export default CustomerFlowSkeleton;
