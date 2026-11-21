import { NextRequest } from 'next/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import CustomerOrderFlow from './CustomerOrderFlow';

/**
 * /s/[shopSlug] — the QR landing (brief §4.1). One page, one job: upload
 * files and choose what to print. If the shop is closed or not accepting
 * orders, say so plainly and show the hours.
 */
export default async function ShopLanding({ params }: { params: Promise<{ shopSlug: string }> }) {
  const { shopSlug } = await params;
  const db = getContainer().db;
  const shop = await db.findOne<{
    id: string; name: string; slug: string; address: string; phone: string;
    isOpen: boolean; acceptingOrders: boolean; openingHours: unknown;
    upiId: string; upiPayeeName: string | null; paymentMode: string;
    minutesPerPageBw: number; minutesPerPageColor: number;
  }>('shop', { slug: shopSlug });
  if (!shop) notFound();

  // Live status: printers online + queue depth → honest wait estimate.
  const printers = await repos.printers.listForShop(shop.id);
  const online = printers.filter(p => p.enabled && p.status === 'ONLINE');
  const queued = await repos.printJobs.findQueuedByShop(shop.id, 50);
  const queuedPages = queued.reduce((sum, t) => sum + (t.sheetCount ?? 1) * (t.copies ?? 1), 0);
  const minPerPp = Math.max(1, Math.round(
    (shop.minutesPerPageBw ?? 1 + (shop.minutesPerPageColor ?? 2)) / 2,
  ));
  const waitMinutes = Math.ceil((queuedPages * minPerPp) / Math.max(1, online.length));
  const rateRows = await repos.priceRules.activeForShop(shop.id);
  const rateSummary = ['BW', 'COLOR'].map(cm => {
    const r = rateRows.find(x => x.colorMode === cm && x.paperSize === 'A4' && x.sides === 'SINGLE');
    return cm === 'BW'
      ? { label: 'B&W', perPagePaise: r?.slabs[0]?.perPagePaise ?? null }
      : { label: 'Color', perPagePaise: r?.slabs[0]?.perPagePaise ?? null };
  });

  const closed = !shop.isOpen || !shop.acceptingOrders;

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="border-b border-ink/15 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-xl items-center justify-between">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            {/* registration mark — the shop's logo stand-in */}
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="text-ink">
              <circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M11 1v20M1 11h20" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            {shop.name}
          </span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${shop.isOpen ? 'bg-[color:var(--p-cyan)]/10 text-[color:var(--p-cyan)]' : 'bg-[color:var(--p-yellow-tint)] text-[color:var(--p-yellow)]'}`}>
            {shop.isOpen ? 'Open now' : 'Closed'}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 pb-24 pt-5 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">Print here in three steps</h1>
        <p className="mt-1 text-sm text-ink/70">
          Upload your file, choose the pages that need color, pay the shop directly by UPI.
        </p>

        {/* rate board strip — the shop's real rules, not decoration */}
        <div className="mt-4 overflow-hidden rounded-lg border border-ink/20 bg-white">
          {rateSummary.map(r => (
            <div key={r.label} className="flex items-baseline justify-between border-b border-ink/10 px-4 py-2 last:border-b-0">
              <span className="text-sm">{r.label} · A4 · single side</span>
              <span className="tabular-nums text-sm font-semibold">
                {r.perPagePaise === null ? 'ask at counter' : `₹${(r.perPagePaise / 100).toFixed(2)}`}
                <span className="text-ink/60"> / page</span>
              </span>
            </div>
          ))}
        </div>

        {closed ? (
          <div className="mt-5 rounded-lg border border-[color:var(--p-yellow)]/40 bg-[color:var(--p-yellow-tint)] p-4 text-sm">
            <p className="font-medium">This shop is not accepting orders right now.</p>
            <p className="mt-1 text-ink/75">
              Hours: {typeof shop.openingHours === 'string' ? shop.openingHours : 'Mon–Sat 9:00–21:00, Sun closed'} · {shop.address}
            </p>
            <p className="mt-1 text-ink/75">You can call the shop at <a className="underline" href={`tel:${shop.phone}`}>{shop.phone}</a>.</p>
          </div>
        ) : (
          <>
            <p className="mt-4 text-sm text-ink/70">
              {online.length} printer{online.length === 1 ? '' : 's'} online · {queued.length} job{queued.length === 1 ? '' : 's'} ahead · about {waitMinutes} min wait
            </p>
            <CustomerOrderFlow shopSlug={shop.slug} paymentMode={shop.paymentMode} />
          </>
        )}
      </main>

      <footer className="border-t border-ink/15 px-4 py-3 text-center text-xs text-ink/60 sm:px-6">
        {shop.address} · <Link href="/shops" className="underline">All shops</Link>
      </footer>
    </div>
  );
}
