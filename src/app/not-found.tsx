import Link from 'next/link';

export const metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

/** 1:1 replica of design board 22 (Site: page not found). */
export default function NotFound() {
  const rows = (
    <>
      <Link href="/" className="r"><span>Find a shop</span><span className="v">›</span></Link>
      <Link href="/orders" className="r"><span>My orders</span><span className="v">›</span></Link>
      <Link href="/help" className="r"><span>Help</span><span className="v">›</span></Link>
    </>
  );

  return (
    <>
      <div className="x m">
        <div className="top"><b style={{ color: '#1C1C1E', fontSize: 17 }}>Printelyx</b></div>
        <h1 className="h">Page not found</h1>
        <p className="sub">The link may be old or mistyped.</p>
        <div className="g">{rows}</div>
        <p className="cap" />
      </div>

      <div className="x d">
        <div className="dtop">
          <b><i className="dot" />Printelyx</b>
          <Link href="/help" className="v">Help</Link>
        </div>
        <div className="wrap">
          <div className="l">
            <h1 className="h1">Page not found</h1>
            <p className="s2">The link may be old or mistyped.</p>
            <div className="gg">{rows}</div>
          </div>
        </div>
      </div>
    </>
  );
}
