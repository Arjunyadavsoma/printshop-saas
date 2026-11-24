import { SiteHeader } from '@/components/clear/site-header';
import { SiteFooter } from '@/components/clear/site-footer';
import { ConsumerTabBar } from '@/components/clear/consumer-tab-bar';

/**
 * InfoShell — shared shell for the public info pages (About, Contact,
 * Help, Pricing, Terms, Privacy, Refund policy, How it works, 404).
 *
 * Centred 1120px container, 720px readable text column, no void.
 * Header/footer are the single shared Clear components (site-header /
 * site-footer). Includes the ConsumerTabBar on mobile for navigation
 * consistency with the flow pages (home, shop, orders, profile, scan).
 *
 * NOTE: this lives in components/clear, NOT in src/app/about/page.tsx.
 * It used to be exported from about/page.tsx, but help/page.tsx is a
 * 'use client' component — importing InfoShell from a page file dragged
 * about/page.tsx (which exports `metadata`) into the client bundle and
 * broke the production build ("attempting to export metadata from a
 * component marked with use client", about/page.tsx:6:14). Page files
 * must never be imported by other routes; shared shells live here.
 */
export function InfoShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-[var(--ground)]">
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-10 pb-[calc(72px+env(safe-area-inset-bottom))] sm:px-6">
        <div className="max-w-[720px]">{children}</div>
      </main>
      <SiteFooter />
      <ConsumerTabBar />
    </div>
  );
}

export default InfoShell;
