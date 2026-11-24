import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'About',
  description: 'What Printelyx is: a direct line from your phone to your local print shop. 0% commission, files deleted after pickup.',
  alternates: { canonical: '/about' },
};

/**
 * /about — 1:1 replica of design board 14 (Site: about).
 * Desktop: same content in the desktop shell (dtop + centered column).
 */
export default function AboutPage() {
  return (
    <>
      <div className="x m">
        <div className="top"><b style={{ color: '#1C1C1E', fontSize: 17 }}>Printelyx</b></div>
        <h1 className="h">About</h1>
        <p className="sub">Print without the queue.</p>
        <div className="g">
          <div className="r">
            <span>0% commission<small>You pay the shop directly by UPI. Shops keep every rupee.</small></span>
            <span className="v" />
          </div>
          <div className="r">
            <span>Private files<small>Deleted 24 hours after pickup.</small></span>
            <span className="v" />
          </div>
          <div className="r">
            <span>Works with your shop<small>Scan the shop&apos;s QR code to start.</small></span>
            <span className="v" />
          </div>
        </div>
        <div className="g">
          <Link href="/help" className="r">
            <span>Questions?<small>Visit Help, or call your shop from your order page.</small></span>
            <span className="v">›</span>
          </Link>
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
            <h1 className="h1">About</h1>
            <p className="s2">Print without the queue.</p>
            <div className="gg">
              <div className="r">
                <span>0% commission<small>You pay the shop directly by UPI. Shops keep every rupee.</small></span>
                <span className="v" />
              </div>
              <div className="r">
                <span>Private files<small>Deleted 24 hours after pickup.</small></span>
                <span className="v" />
              </div>
              <div className="r">
                <span>Works with your shop<small>Scan the shop&apos;s QR code to start.</small></span>
                <span className="v" />
              </div>
            </div>
            <div className="gg">
              <Link href="/help" className="r">
                <span>Questions?<small>Visit Help, or call your shop from your order page.</small></span>
                <span className="v">›</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
