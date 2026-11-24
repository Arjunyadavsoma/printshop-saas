import Link from 'next/link';

import { hasSupportEmail, supportMailto } from '@/lib/customer/support-config';

/**
 * /privacy — 1:1 replica of design board 16 (Site: privacy).
 * The retention numbers are the product's real SLA (24h after pickup, 7d
 * max) — they mirror the cleanup cron at /api/v1/cron/cleanup.
 */

/** Kept in code so the shipped page always states a real, correct date. */
const LAST_UPDATED = '24 November 2026';

export const metadata = {
  title: 'Privacy',
  description: 'What Printelyx collects, what it never collects, and exactly how long your files are kept.',
  alternates: { canonical: '/privacy' },
};

function PrivacyCard({ cls }: { cls: 'g' | 'gg' }) {
  return (
    <div className={cls}>
      <div className="r">
        <span>What we collect<small>Phone number (optional), your files for a short time, order details.</small></span>
        <span className="v" />
      </div>
      <div className="r">
        <span>What we never collect<small>Card or UPI details. You pay the shop directly.</small></span>
        <span className="v" />
      </div>
      <div className="r">
        <span>How long we keep files<small>24 hours after pickup, 7 days at most. Then deleted automatically.</small></span>
        <span className="v" />
      </div>
      <div className="r">
        <span>Who sees your data<small>Only the shop you order from. Never sold, never used for ads.</small></span>
        <span className="v" />
      </div>
      <div className="r">
        <span>Analytics<small>Privacy-friendly counts only — no personal data, no file names, no UTRs.</small></span>
        <span className="v" />
      </div>
      {hasSupportEmail() ? (
        <a className="r" href={supportMailto('Printelyx privacy request', 'I would like my data deleted. My order token (if known):')}>
          <span>Delete my data<small>Ask the shop or email us — files purge within 24 hours.</small></span>
          <span className="v">›</span>
        </a>
      ) : (
        <div className="r">
          <span>Delete my data<small>Ask the shop you ordered from — files purge within 24 hours.</small></span>
          <span className="v">›</span>
        </div>
      )}
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <div className="x m">
        <div className="top"><b style={{ color: '#1C1C1E', fontSize: 17 }}>Printelyx</b></div>
        <h1 className="h">Privacy</h1>
        <p className="sub">Last updated {LAST_UPDATED}</p>
        <PrivacyCard cls="g" />
        <div className="g">
          <Link href="/help" className="r"><span>Questions?</span><span className="v">›</span></Link>
          <Link href="/" className="r"><span>Home</span><span className="v">›</span></Link>
        </div>
        <p className="cap" />
      </div>

      <div className="x d">
        <div className="dtop">
          <b><i className="dot" />Printelyx</b>
          <Link href="/help" className="v">Help</Link>
        </div>
        <div className="wrap">
          <div className="l">
            <h1 className="h1">Privacy</h1>
            <p className="s2">Last updated {LAST_UPDATED}</p>
            <PrivacyCard cls="gg" />
            <div className="gg">
              <Link href="/help" className="r"><span>Questions?</span><span className="v">›</span></Link>
              <Link href="/" className="r"><span>Home</span><span className="v">›</span></Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
