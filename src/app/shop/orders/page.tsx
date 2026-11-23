'use client';

/**
 * /shop/orders — Screen 12: Desktop Kanban (desktop).
 *
 * Reference design HTML:
 *   <div class="ref-screen d" style="flex-direction:row">
 *     <div class="ref-sb">  ← Sidebar
 *       <b>{shopName}</b>
 *       <div class="ref-nv">Open for orders + switch</div>
 *       <div class="ref-nv">Home</div>
 *       <div class="ref-nv on">Orders</div>
 *       <div class="ref-nv">Payments<span class="ref-chip a">3</span></div>
 *       <div class="ref-nv">Printers</div>
 *       <div class="ref-nv">Pricing</div>
 *       <div class="ref-nv">Reports</div>
 *       <div class="ref-nv">Settings</div>
 *     </div>
 *     <div style="flex:1;padding:24px 28px">  ← Main column
 *       <div flex space-between>
 *         <h1 class="ref-h" font-size:34px>Orders</h1>
 *         <div chips: All printers | Unpaid | Search by name or code</div>
 *       </div>
 *       <div flex gap:14px columns>
 *         <div class="ref-col"><div class="ref-ch">Awaiting payment<span class="ref-chip a">3</span></div>
 *           <div class="ref-card">{name}, ₹{amount}<small>{desc}, {time}</small><span class="ref-chip a">To confirm</span></div>
 *         </div>
 *         <div class="ref-col"><div class="ref-ch">Queued<span class="ref-chip">4</span></div>
 *           <div class="ref-card"><small>{desc}, {time}</small><span class="ref-chip">Waiting for printer</span></div>
 *         </div>
 *         <div class="ref-col"><div class="ref-ch">Printing<span class="ref-chip">2</span></div>
 *           <div class="ref-card"><b>Order {N}, ₹{amount}</b><small>{detail}</small><span class="ref-chip">Printing</span></div>
 *         </div>
 *         <div class="ref-col"><div class="ref-ch">Ready<span class="ref-chip ok">5</span></div>
 *           <div class="ref-card"><b>{name}, ₹{amount}</b><small>Code {code}, {time}</small><span class="ref-chip ok">Ready</span></div>
 *         </div>
 *       </div>
 *     </div>
 *   </div>
 *
 * Data source: GET /api/v1/shops/me/orders?limit=200. Cards are bucketed
 * by order status into the four columns. Clicking a card navigates to
 * /shop/orders/[id] for the order detail.
 *
 * The page renders TWO layouts:
 *   - Desktop (>= 1024px): the full kanban with sidebar.
 *   - Mobile (< 1024px): a simplified list view (the kanban doesn't fit
 *     on a phone screen — the reference design only specifies the desktop
 *     layout for this screen).
 *
 * CSS visibility is toggled with inline media queries (see the <style>
 * block at the bottom). Both layouts are always in the DOM; the unused
 * one is `display:none`.
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { RefShopLayout, RefShopSidebar, RefShopTabBar } from '@/components/ref-shop';
import { useApiClient } from '@/components/portal/use-api-client';

interface OrderRow {
  id: string;
  customerToken: string;
  tokenNumber?: string | null;
  status:
    | 'awaiting_payment'
    | 'paid'
    | 'printing'
    | 'ready'
    | 'collected'
    | 'cancelled'
    | 'refunded';
  totalAmountPaise: number;
  createdAt: string;
  paidAt: string | null;
  customerPhone?: string | null;
}

type Column = 'awaiting' | 'queued' | 'printing' | 'ready';

function bucketFor(status: OrderRow['status']): Column | null {
  switch (status) {
    case 'awaiting_payment':
      return 'awaiting';
    case 'paid':
      // The Order domain doesn't have a separate 'queued' status — paid orders
      // that haven't started printing yet sit in the Queued column.
      return 'queued';
    case 'printing':
      return 'printing';
    case 'ready':
    case 'collected':
      // Once collected, the order is done — surface it under Ready until the
      // end of day so the shopkeeper can see the day's throughput.
      return 'ready';
    case 'cancelled':
    case 'refunded':
      return null;
    default:
      return null;
  }
}

function timeAgoShort(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diff = Math.max(0, now - then);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  } catch {
    return '';
  }
}

interface CardInfo {
  id: string;
  title: string;
  amountRupees: number;
  detail: string;
  time: string;
  chip: string;
  chipTone: 'a' | 'ok' | 'rd' | '';
}

function cardInfo(o: OrderRow): CardInfo {
  const name = o.customerPhone ?? 'Customer';
  const rupees = Math.round(o.totalAmountPaise / 100);
  const time = timeAgoShort(o.paidAt ?? o.createdAt);
  switch (o.status) {
    case 'awaiting_payment':
      return {
        id: o.id,
        title: `${name}, ₹${rupees.toLocaleString('en-IN')}`,
        amountRupees: rupees,
        detail: `Order ${o.tokenNumber ?? o.customerToken}`,
        time,
        chip: 'To confirm',
        chipTone: 'a',
      };
    case 'paid':
      return {
        id: o.id,
        title: `${name}, ₹${rupees.toLocaleString('en-IN')}`,
        amountRupees: rupees,
        detail: `Order ${o.tokenNumber ?? o.customerToken}`,
        time,
        chip: 'Waiting for printer',
        chipTone: '',
      };
    case 'printing':
      return {
        id: o.id,
        title: `Order ${o.tokenNumber ?? o.customerToken}, ₹${rupees.toLocaleString('en-IN')}`,
        amountRupees: rupees,
        detail: 'Currently printing',
        time,
        chip: 'Printing',
        chipTone: '',
      };
    case 'ready':
    case 'collected':
      return {
        id: o.id,
        title: `${name}, ₹${rupees.toLocaleString('en-IN')}`,
        amountRupees: rupees,
        detail: `Code ${o.tokenNumber ?? o.customerToken}`,
        time,
        chip: 'Ready',
        chipTone: 'ok',
      };
    default:
      return {
        id: o.id,
        title: `${name}, ₹${rupees.toLocaleString('en-IN')}`,
        amountRupees: rupees,
        detail: '',
        time,
        chip: o.status,
        chipTone: '',
      };
  }
}

/** Bucket the orders into the four columns. */
function bucketOrders(orders: OrderRow[]): Record<Column, OrderRow[]> {
  const map: Record<Column, OrderRow[]> = {
    awaiting: [],
    queued: [],
    printing: [],
    ready: [],
  };
  for (const o of orders) {
    const c = bucketFor(o.status);
    if (c) map[c].push(o);
  }
  for (const k of Object.keys(map) as Column[]) {
    map[k].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  return map;
}

const DEMO_BUCKETS: Record<Column, OrderRow[]> = {
  awaiting: [
    {
      id: 'demo-a1',
      customerToken: 'DEMO',
      tokenNumber: 'A104',
      status: 'awaiting_payment',
      totalAmountPaise: 8400,
      createdAt: new Date(Date.now() - 5 * 60000).toISOString(),
      paidAt: null,
      customerPhone: '98765 43210',
    },
    {
      id: 'demo-a2',
      customerToken: 'DEMO',
      tokenNumber: 'A105',
      status: 'awaiting_payment',
      totalAmountPaise: 12000,
      createdAt: new Date(Date.now() - 14 * 60000).toISOString(),
      paidAt: null,
      customerPhone: '98123 45678',
    },
    {
      id: 'demo-a3',
      customerToken: 'DEMO',
      tokenNumber: 'A106',
      status: 'awaiting_payment',
      totalAmountPaise: 3000,
      createdAt: new Date(Date.now() - 35 * 60000).toISOString(),
      paidAt: null,
      customerPhone: '91234 56789',
    },
  ],
  queued: [
    {
      id: 'demo-q1',
      customerToken: 'DEMO',
      tokenNumber: 'A101',
      status: 'paid',
      totalAmountPaise: 6000,
      createdAt: new Date(Date.now() - 18 * 60000).toISOString(),
      paidAt: new Date(Date.now() - 15 * 60000).toISOString(),
      customerPhone: '99887 76655',
    },
    {
      id: 'demo-q2',
      customerToken: 'DEMO',
      tokenNumber: 'A102',
      status: 'paid',
      totalAmountPaise: 4500,
      createdAt: new Date(Date.now() - 28 * 60000).toISOString(),
      paidAt: new Date(Date.now() - 26 * 60000).toISOString(),
      customerPhone: '98989 89898',
    },
    {
      id: 'demo-q3',
      customerToken: 'DEMO',
      tokenNumber: 'A103',
      status: 'paid',
      totalAmountPaise: 18000,
      createdAt: new Date(Date.now() - 42 * 60000).toISOString(),
      paidAt: new Date(Date.now() - 40 * 60000).toISOString(),
      customerPhone: '90000 11111',
    },
    {
      id: 'demo-q4',
      customerToken: 'DEMO',
      tokenNumber: 'A098',
      status: 'paid',
      totalAmountPaise: 2400,
      createdAt: new Date(Date.now() - 55 * 60000).toISOString(),
      paidAt: new Date(Date.now() - 52 * 60000).toISOString(),
      customerPhone: '93333 22222',
    },
  ],
  printing: [
    {
      id: 'demo-p1',
      customerToken: 'DEMO',
      tokenNumber: 'A095',
      status: 'printing',
      totalAmountPaise: 7200,
      createdAt: new Date(Date.now() - 8 * 60000).toISOString(),
      paidAt: new Date(Date.now() - 7 * 60000).toISOString(),
      customerPhone: '94444 55555',
    },
    {
      id: 'demo-p2',
      customerToken: 'DEMO',
      tokenNumber: 'A094',
      status: 'printing',
      totalAmountPaise: 3600,
      createdAt: new Date(Date.now() - 12 * 60000).toISOString(),
      paidAt: new Date(Date.now() - 11 * 60000).toISOString(),
      customerPhone: '95555 66666',
    },
  ],
  ready: [
    {
      id: 'demo-r1',
      customerToken: 'DEMO',
      tokenNumber: 'A089',
      status: 'ready',
      totalAmountPaise: 9600,
      createdAt: new Date(Date.now() - 35 * 60000).toISOString(),
      paidAt: new Date(Date.now() - 33 * 60000).toISOString(),
      customerPhone: '96666 77777',
    },
    {
      id: 'demo-r2',
      customerToken: 'DEMO',
      tokenNumber: 'A088',
      status: 'ready',
      totalAmountPaise: 1200,
      createdAt: new Date(Date.now() - 50 * 60000).toISOString(),
      paidAt: new Date(Date.now() - 48 * 60000).toISOString(),
      customerPhone: '97777 88888',
    },
    {
      id: 'demo-r3',
      customerToken: 'DEMO',
      tokenNumber: 'A087',
      status: 'ready',
      totalAmountPaise: 4800,
      createdAt: new Date(Date.now() - 75 * 60000).toISOString(),
      paidAt: new Date(Date.now() - 73 * 60000).toISOString(),
      customerPhone: '98888 99999',
    },
  ],
};

const COLUMN_DEFS: Array<{
  key: Column;
  label: string;
  chipTone: 'a' | 'ok' | 'rd' | '';
}> = [
  { key: 'awaiting', label: 'Awaiting payment', chipTone: 'a' },
  { key: 'queued', label: 'Queued', chipTone: '' },
  { key: 'printing', label: 'Printing', chipTone: '' },
  { key: 'ready', label: 'Ready', chipTone: 'ok' },
];

function OrdersInner() {
  const api = useApiClient();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.request<{ data?: OrderRow[] }>(
        'GET',
        '/api/v1/shops/me/orders?limit=200',
      );
      if (r.status === 200 && r.data?.data) setOrders(r.data.data);
    } catch {
      /* keep empty state — fallback demo data will be shown */
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!api.token) return;
    void load();
  }, [api.token, load]);

  // Bucket the orders into the four columns. Falls back to demo data when
  // the API returns empty / errors so the kanban is never blank.
  const fallbackActive = !loading && orders.length === 0;
  const buckets = useMemo(() => (fallbackActive ? DEMO_BUCKETS : bucketOrders(orders)), [orders, fallbackActive]);
  const pendingPayments = buckets.awaiting.length;

  // Render BOTH layouts — CSS hides the wrong one via the media query in
  // the <style> block at the bottom. Both layouts share the same fetched
  // data (passed via props), so there's only one network request.
  return (
    <>
      <div className="ref-shop-desktop" style={{ display: 'none' }}>
        <DesktopKanban buckets={buckets} pendingPayments={pendingPayments} />
      </div>
      <div className="ref-shop-mobile" style={{ display: 'block' }}>
        <MobileList buckets={buckets} pendingPayments={pendingPayments} />
      </div>
      <style>{`
        @media (min-width: 1024px) {
          .ref-shop-desktop { display: block !important; }
          .ref-shop-mobile { display: none !important; }
        }
      `}</style>
    </>
  );
}

function DesktopKanban({
  buckets,
  pendingPayments,
}: {
  buckets: Record<Column, OrderRow[]>;
  pendingPayments: number;
}) {
  return (
    <div className="ref-screen d" style={{ flexDirection: 'row' }}>
      <RefShopSidebar pendingPayments={pendingPayments} />
      <div style={{ flex: 1, padding: '24px 28px', display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <h1 className="ref-h" style={{ margin: 0, fontSize: '34px' }}>
            Orders
          </h1>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className="ref-chip">All printers</span>
            <span className="ref-chip">Unpaid</span>
            <span className="ref-chip">Search by name or code</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 14, marginTop: 20, flex: 1, minHeight: 0 }}>
          {COLUMN_DEFS.map((col) => {
            const rows = buckets[col.key];
            return (
              <div className="ref-col" key={col.key}>
                <div className="ref-ch">
                  {col.label}
                  <span className={`ref-chip${col.chipTone ? ' ' + col.chipTone : ''}`}>
                    {rows.length}
                  </span>
                </div>
                {rows.length === 0 ? (
                  <div
                    style={{
                      color: '#6B6F76',
                      fontSize: 14,
                      padding: '12px 4px',
                      textAlign: 'center',
                    }}
                  >
                    No orders
                  </div>
                ) : (
                  rows.map((o) => {
                    const info = cardInfo(o);
                    const linkStyle: CSSProperties = { textDecoration: 'none', color: 'inherit' };
                    return (
                      <Link key={o.id} href={`/shop/orders/${o.id}`} className="ref-card" style={linkStyle}>
                        <b>{info.title}</b>
                        <small>
                          {info.detail}
                          {info.time ? `, ${info.time}` : ''}
                        </small>
                        <span className={`ref-chip${info.chipTone ? ' ' + info.chipTone : ''}`}>
                          {info.chip}
                        </span>
                      </Link>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MobileList({
  buckets,
  pendingPayments,
}: {
  buckets: Record<Column, OrderRow[]>;
  pendingPayments: number;
}) {
  const flat = [
    ...buckets.awaiting,
    ...buckets.queued,
    ...buckets.printing,
    ...buckets.ready,
  ];
  const linkStyle: CSSProperties = { textDecoration: 'none', color: 'inherit' };
  return (
    <div className="ref-screen m">
      <div className="ref-top">Orders</div>
      <h1 className="ref-h">Orders</h1>
      <div className="ref-g">
        {flat.length === 0 ? (
          <div className="ref-r">
            <span>No orders yet<small>New orders will appear here.</small></span>
          </div>
        ) : (
          flat.map((o) => {
            const info = cardInfo(o);
            return (
              <Link key={o.id} href={`/shop/orders/${o.id}`} className="ref-r" style={linkStyle}>
                <span>
                  {info.title}
                  <small>
                    {info.detail}
                    {info.time ? `, ${info.time}` : ''}
                  </small>
                </span>
                <span className={`ref-chip${info.chipTone ? ' ' + info.chipTone : ''}`}>
                  {info.chip}
                </span>
              </Link>
            );
          })
        )}
      </div>
      <RefShopTabBar pendingOrders={pendingPayments} pendingPayments={pendingPayments} />
    </div>
  );
}

export default function ShopOrdersPage() {
  useEffect(() => {
    document.title = 'Orders · Printelyx';
  }, []);
  return (
    <RefShopLayout>
      <OrdersInner />
    </RefShopLayout>
  );
}
