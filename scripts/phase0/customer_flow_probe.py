#!/usr/bin/env python3
"""Phase 0c — customer QR flow probe against the LOCAL stack:
create order (public API) -> open shop page -> open order tracking page.
Extracts the probe shop's slug from the companion-probe log so it reuses the
already-registered shop."""
import json
import re
import urllib.request

BASE = "http://127.0.0.1:3000"
log = open("/home/z/my-project/repos/printshop-saas/docs/audit/phase0/15-companion-probe-local.log").read()
stamp = re.search(r"qa-login-(\d+)@printshop\.test", log).group(1)
slug = f"qa-shop-{stamp}"

def call(url, method="GET", body=None):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, {}

st, order = call(f"{BASE}/api/v1/shops/{slug}/orders", "POST", {"customerPhone": "9876543210", "notes": "QR flow probe"})
tok = (order.get("data") or {}).get("customerToken", "")
oid = (order.get("data") or {}).get("orderId", "")
print(f"[{'PASS' if st in (200,201) else 'FAIL'}] POST /shops/{slug}/orders -> {st} customerToken={tok[:3]}… orderId={oid[:8]}…")

req = urllib.request.Request(f"{BASE}/shops/{slug}")
with urllib.request.urlopen(req, timeout=30) as r:
    html = r.read().decode()
ok = r.status == 200 and slug in html
print(f"[{'PASS' if ok else 'FAIL'}] GET /shops/{slug} -> {r.status} ({len(html)} bytes)")

req = urllib.request.Request(f"{BASE}/orders/{oid}")
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        html = r.read().decode()
        print(f"[{'PASS' if r.status == 200 else 'FAIL'}] GET /orders/{oid} -> {r.status} ({len(html)} bytes)")
except urllib.error.HTTPError as e:
    print(f"[FAIL] GET /orders/{oid} -> HTTP {e.code}")
