/**
 * /o/[token]/loading — order skeleton (token slip + timeline).
 *
 * Server-rendered (no client state). Mirrors the tracking-page layout so the
 * swap-in is invisible: a token-slip-shaped card with perforation hints, a
 * 5-step timeline skeleton, and a small price row skeleton at the bottom.
 */
import { SkeletonBox, SkeletonText } from '@/components/customer/skeleton';

export default function OrderLoading() {
  return (
    <div className="customer-flow">
      {/* AppBar skeleton — same shape as the shop one but with a status pill */}
      <header className="sticky top-0 z-10 bg-[var(--color-paper)] border-b border-[var(--color-border-ink)] safe-top">
        <div className="flex items-center gap-3 px-4 min-h-[56px]">
          <SkeletonBox width={24} height={24} radius="var(--radius-tight)" />
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <SkeletonText lines={1} width="short" />
            <SkeletonText lines={1} width="medium" />
          </div>
          <SkeletonBox width={84} height={22} radius="9999px" />
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-6 space-y-6 safe-bottom">
        {/* Token slip skeleton — perforated edges preserved */}
        <div className="rounded-[var(--radius-soft)] bg-[var(--color-surface)] perforated-top perforated-bottom shadow-[var(--shadow-slip)] overflow-hidden">
          <div className="px-5 py-6 flex flex-col items-center gap-4">
            <SkeletonText lines={1} width="short" />
            <SkeletonBox width={120} height={36} radius="var(--radius-default)" />
            <div className="w-full border-t border-dashed border-[var(--color-border-ink)]" />
            <div className="w-full space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <SkeletonText lines={1} width="short" />
                <SkeletonText lines={1} width="medium" />
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <SkeletonText lines={1} width="short" />
                <SkeletonText lines={1} width="medium" />
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <SkeletonText lines={1} width="short" />
                <SkeletonText lines={1} width="medium" />
              </div>
            </div>
            <SkeletonBox width={96} height={96} radius="var(--radius-tight)" />
          </div>
        </div>

        {/* Timeline skeleton — 5 numbered steps */}
        <div className="space-y-3">
          <SkeletonText lines={1} width="short" />
          <ol className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="flex gap-3">
                <SkeletonBox width={32} height={32} radius="9999px" />
                <div className="flex-1 pt-1">
                  <SkeletonText lines={1} width="medium" />
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Price row skeleton */}
        <div className="rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] px-4 py-3 flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <SkeletonBox width={64} height={28} radius="var(--radius-tight)" />
            <SkeletonText lines={1} width="short" />
          </div>
          <SkeletonBox width={84} height={22} radius="9999px" />
        </div>

        {/* Actions skeleton */}
        <div className="grid grid-cols-2 gap-2">
          <SkeletonBox width="100%" height={48} radius="var(--radius-default)" />
          <SkeletonBox width="100%" height={48} radius="var(--radius-default)" />
          <SkeletonBox width="100%" height={48} radius="var(--radius-default)" />
        </div>
      </main>
    </div>
  );
}
