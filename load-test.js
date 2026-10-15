// PrintShop SaaS — k6 load test (spec §14, target: 100 orders/min on free tier).
//
// Run:   k6 run load-test.js --env BASE_URL=https://printshop-api.onrender.com
// Local: k6 run load-test.js --env BASE_URL=http://localhost:81
//
// Exercises the public customer flow (shop info → create order) at the target
// throughput. The create-order endpoint is the hottest path; upload/checkout
// are heavier and kept at a lower share to stay within free-tier limits.
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:81';
const SHOP_SLUG = __ENV.SHOP_SLUG || 'quickprint';

const orderCreateOk = new Rate('order_create_ok');
const shopInfoTrend = new Trend('shop_info_ms');
const orderCreateTrend = new Trend('order_create_ms');

export const options = {
  // Target: 100 orders/min sustained — ~1.67/sec. We push a bit harder to
  // find the free-tier ceiling.
  scenarios: {
    customer_load: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 5 },   // warm up to 5 VUs
        { duration: '1m', target: 10 },   // hold at 10 VUs (the sustained load)
        { duration: '30s', target: 0 },   // ramp down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    order_create_ok: ['rate>0.99'],            // >99% of create-order calls succeed
    http_req_duration: ['p(95)<2000'],          // p95 < 2s (free-tier bound)
    'http_req_failed': ['rate<0.01'],
  },
};

export default function loadTest() {
  group('shop info', () => {
    const r = http.get(`${BASE}/api/v1/shops/${SHOP_SLUG}`);
    shopInfoTrend.add(r.timings.duration);
    check(r, { 'shop 200': (res) => res.status === 200 });
  });

  group('create order', () => {
    const r = http.post(`${BASE}/api/v1/shops/${SHOP_SLUG}/orders`, JSON.stringify({}),
      { headers: { 'Content-Type': 'application/json' } });
    orderCreateTrend.add(r.timings.duration);
    const ok = check(r, {
      'order 200': (res) => res.status === 200,
      'has orderId': (res) => {
        try { return !!JSON.parse(res.body).data.orderId; } catch { return false; }
      },
    });
    orderCreateOk.add(ok);
  });

  sleep(0.5);
}

export function handleSummary(data) {
  const target = (100 / 60).toFixed(2);
  const actual = (data.metrics['http_reqs'] && data.metrics['http_reqs'].rate) ? data.metrics['http_reqs'].rate : 0;
  const p95 = (data.metrics['http_req_duration'] && data.metrics['http_req_duration']['p(95)']) ? data.metrics['http_req_duration']['p(95)'] : 0;
  const failRate = (data.metrics['http_req_failed'] && typeof data.metrics['http_req_failed'].rate === 'number') ? data.metrics['http_req_failed'].rate * 100 : 0;
  console.log(`\n=== load test summary ===`);
  console.log(`target orders/min: 100 (≈ ${target}/s)`);
  console.log(`achieved req/s:    ${actual.toFixed(2)}`);
  console.log(`p95 latency:       ${p95.toFixed(0)}ms`);
  console.log(`fail rate:         ${failRate.toFixed(2)}%`);
  return {};
}
