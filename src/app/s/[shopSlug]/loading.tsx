/**
 * /s/[shopSlug]/loading — shop skeleton (AppBar + dropzone + rate board).
 *
 * Server-rendered (no client state) so it appears instantly on navigation.
 * Mirrors the real shop-landing layout so the swap-in is invisible.
 */
import { SkeletonBox } from '@/components/clear/skeleton';

export default function ShopLoading() {
  return (
    <div className="">
      {/* AppBar skeleton */}
      <header className="sticky top-0 z-10 bg-[var(--color-paper)] border-b border-[var(--color-border-ink)] safe-top">
        <div className="flex items-center gap-3 px-4 min-h-[56px]">
          <SkeletonBox width={22} height={22} radius="9999px" />
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <SkeletonBox width="short" height={20} />
          </div>
          <SkeletonBox width={56} height={22} radius="9999px" />
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-6 space-y-5 safe-bottom">
        {/* H1 + intro */}
        <div className="space-y-2">
          <SkeletonBox height={28} width="80%" radius="var(--radius-tight)" />
          <SkeletonBox width="long" height={20} />
        </div>

        {/* Rate board strip skeleton */}
        <div className="rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--color-border-ink)] px-4 py-3">
            <SkeletonBox width="medium" height={20} />
            <SkeletonBox width={64} height={20} radius="var(--radius-tight)" />
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <SkeletonBox width="medium" height={20} />
            <SkeletonBox width={64} height={20} radius="var(--radius-tight)" />
          </div>
        </div>

        {/* Wait-estimate skeleton */}
        <SkeletonBox width="medium" height={20} />

        {/* Dropzone skeleton */}
        <div className="rounded-[var(--radius-soft)] border-2 border-dashed border-[var(--color-border-ink-strong)] bg-[var(--color-surface)] p-8">
          <div className="flex flex-col items-center gap-3">
            <SkeletonBox width={48} height={48} radius="9999px" />
            <SkeletonBox width="short" height={20} />
            <SkeletonBox width="medium" height={20} />
          </div>
        </div>

        {/* Sticky bottom bar skeleton */}
        <div className="fixed inset-x-0 bottom-0 bg-[var(--color-surface)] border-t border-[var(--color-border-ink)] safe-bottom-bar">
          <div className="mx-auto max-w-xl px-4 py-3 flex items-center gap-3">
            <div className="flex-1">
              <SkeletonBox width="short" height={20} />
            </div>
            <SkeletonBox width={120} height={48} radius="var(--radius-default)" />
          </div>
        </div>
      </main>
    </div>
  );
}
