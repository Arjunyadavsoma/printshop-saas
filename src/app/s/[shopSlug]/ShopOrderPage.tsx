'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ConsumerTabBar } from '@/components/clear/consumer-tab-bar';
import { SiteFooter } from '@/components/clear/site-footer';
import { CustomerOrderFlowV2Lazy } from './CustomerOrderFlowV2Lazy';

export interface ShopOrderPageProps {
  shopSlug: string;
  shopName: string;
  upiId: string;
  upiPayeeName: string;
  paymentMode: string;
  retentionHours: number;
  bwPrice: string;
  colorPrice: string;
  doubleBwPrice: string | null;
  bwPerPagePaise: number | null;
  colorPerPagePaise: number | null;
  pricesFromConfig: boolean;
  hours: string;
  waitMinutes: number;
  printerCount: number;
  shopPhone: string;
  shopAddress: string;
  closed: boolean;
}

/**
 * /s/[shopSlug] — shop landing + order flow.
 * Clear design (matches the reference "Customer: shop landing" screen):
 *   Mobile: top bar (shop name + open) → "Print without the queue" → status
 *   → add-files card → prices card → shop-info card → retention caption.
 *   Desktop: dtop bar + two-column (content left, sidebar right).
 *
 * Tapping "Add files" mounts CustomerOrderFlowV2 (the multi-step upload →
 * options → pay flow). The flow keeps its .rv-* internals (now using
 * Instrument Sans for font consistency).
 */
export function ShopOrderPage(props: ShopOrderPageProps) {
  const {
    shopSlug, shopName, upiId, upiPayeeName, paymentMode, retentionHours,
    bwPrice, colorPrice, doubleBwPrice, bwPerPagePaise, colorPerPagePaise, pricesFromConfig,
    hours, waitMinutes, printerCount, shopPhone, shopAddress, closed,
  } = props;
  const [started, setStarted] = useState(false);

  const statusLine = `${printerCount} ${printerCount === 1 ? 'printer' : 'printers'} online, about ${waitMinutes} min wait`;
  const directionsUrl = shopAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shopAddress)}`
    : undefined;

  /* ── Prices card (Clear .g with .r rows) ── */
  const priceCard = (isDesktop = false) => (
    <div className={isDesktop ? 'gg' : 'g'}>
      <div className="r">
        <span>Black &amp; white<small>per page</small></span>
        <b style={{ fontSize: 16, fontWeight: 600 }}>{bwPrice}</b>
      </div>
      <div className="r">
        <span>Colour<small>per page</small></span>
        <b style={{ fontSize: 16, fontWeight: 600 }}>{colorPrice}</b>
      </div>
      <div className="r">
        <span>Double-sided</span>
        <span className="v">{doubleBwPrice != null ? doubleBwPrice : 'Costs less per page'}</span>
      </div>
      {!pricesFromConfig && (
        <p className="cap" style={{ margin: '8px 0 0' }}>Standard rates — this shop hasn&apos;t set its own prices yet.</p>
      )}
    </div>
  );

  /* ── Shop info card ── */
  const shopInfoCard = (isDesktop = false) => (
    <div className={isDesktop ? 'gg' : 'g'}>
      <div className="r">
        <span>Open today</span>
        <span className="v">{hours}</span>
      </div>
      <div className="r">
        <span>Contact</span>
        <span className="v" style={{ display: 'flex', gap: 12 }}>
          {shopPhone ? <a href={`tel:${shopPhone}`} style={{ color: '#0A58D6', textDecoration: 'none', fontSize: 15 }}>Call shop</a> : null}
          {directionsUrl ? <a href={directionsUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#0A58D6', textDecoration: 'none', fontSize: 15 }}>Directions</a> : null}
        </span>
      </div>
      {shopAddress && (
        <p className="cap" style={{ margin: '8px 0 0' }}>{shopAddress}</p>
      )}
    </div>
  );

  /* ── Add files card ── */
  const addFilesCard = (isDesktop = false) => (
    <div className={isDesktop ? 'gg p' : 'g p'} style={{ textAlign: 'center', padding: '28px 16px' }}>
      <div style={{ fontSize: 17, fontWeight: 600, color: '#1C1C1E' }}>Add files to print</div>
      <div className="v" style={{ textAlign: 'center', margin: '4px 0 16px' }}>PDF, photos or Word files · up to 50 MB each</div>
      <button type="button" className="btn" style={{ width: '100%' }} onClick={() => setStarted(true)}>
        Add files
      </button>
    </div>
  );

  /* ── Closed state ── */
  if (closed) {
    return (
      <>
        <div className="x m">
          <div className="top"><i className="dot" />{shopName}, closed</div>
          <h1 className="h">Closed right now</h1>
          <p className="sub">Opens at the next opening time.</p>
          <div className="g">
            <div className="r"><span>Hours</span><span className="v">{hours}</span></div>
            {shopPhone ? (
              <a href={`tel:${shopPhone}`} className="r" style={{ textDecoration: 'none', color: 'inherit' }}>
                <span>Call the shop</span><span className="v">›</span>
              </a>
            ) : null}
          </div>
          <p className="cap">Come back when the shop opens. Nothing is uploaded until then.</p>
          <p className="cap"><Link href="/" style={{ color: '#0A58D6', textDecoration: 'none' }}>Find another shop</Link></p>
          <div style={{ height: 'calc(80px + env(safe-area-inset-bottom))' }} />
        </div>
        <div className="x d">
          <div className="dtop">
            <b><i className="dot" />{shopName}</b>
            <span className="v"><Link href="/" style={{ color: '#5B5F66', textDecoration: 'none' }}>Home</Link></span>
          </div>
          <div className="wrap"><div className="l" style={{ maxWidth: 560, margin: '0 auto' }}>
            <h1 className="h1">Closed right now</h1>
            <p className="s2">Opens at the next opening time.</p>
            <div className="gg"><div className="r"><span>Hours</span><span className="v">{hours}</span></div></div>
            <p className="cap">Come back when the shop opens. Nothing is uploaded until then.</p>
            <p className="cap"><Link href="/" style={{ color: '#0A58D6', textDecoration: 'none' }}>Find another shop</Link></p>
          </div></div>
          <SiteFooter />
        </div>
        <ConsumerTabBar />
      </>
    );
  }

  /* ── Order flow started — keep CustomerOrderFlowV2 but in Clear container ── */
  if (started) {
    return (
      <CustomerOrderFlowV2Lazy
        shopSlug={shopSlug}
        shopName={shopName}
        upiId={upiId}
        upiPayeeName={upiPayeeName}
        paymentMode={paymentMode}
        retentionHours={retentionHours}
        bwPerPagePaise={bwPerPagePaise}
        colorPerPagePaise={colorPerPagePaise}
      />
    );
  }

  /* ── Landing state ── */
  return (
    <>
      {/* Mobile */}
      <div className="x m">
        <div className="top"><i className="dot" />{shopName}, open</div>
        <h1 className="h">Print without the queue</h1>
        <p className="sub">{statusLine}</p>
        {addFilesCard()}
        {priceCard()}
        {shopInfoCard()}
        <p className="cap">Your files are deleted {retentionHours ? `${retentionHours} hours` : '24 hours'} after pickup.</p>
        <div style={{ height: 'calc(80px + env(safe-area-inset-bottom))' }} />
      </div>

      {/* Desktop */}
      <div className="x d">
        <div className="dtop">
          <b><i className="dot" />{shopName}</b>
          <span className="v">
            <Link href="/" style={{ color: '#5B5F66', textDecoration: 'none', marginRight: 20 }}>Home</Link>
            <Link href="/track" style={{ color: '#5B5F66', textDecoration: 'none', marginRight: 20 }}>Track order</Link>
            <Link href="/help" style={{ color: '#5B5F66', textDecoration: 'none' }}>Help</Link>
          </span>
        </div>
        <div className="wrap">
          <div className="l">
            <h1 className="h1">Print without the queue</h1>
            <p className="s2">{statusLine}</p>
            {addFilesCard(true)}
          </div>
          <div className="rt">
            {priceCard(true)}
            {shopInfoCard(true)}
            <p className="cap">Your files are deleted {retentionHours ? `${retentionHours} hours` : '24 hours'} after pickup.</p>
          </div>
        </div>
        <SiteFooter />
      </div>

      <ConsumerTabBar />
    </>
  );
}
