#!/usr/bin/env python3
"""Phase 3 — LIVE delivery-surface E2E probe (P2-7 + P2-8).

Flow: register shop → pair companion device → seed PhonePe creds + ₹5.00
order → checkout → signed webhook (Phase 2's proven format) → order enters
print pipeline → the device CLAIMS the job (pending → printing) → posts
/received → THEN assert the two NEW read surfaces:
  - GET /shops/me/deliveries   (P2-8 dashboard history: file + device + status)
  - GET /orders/{id}/status    (P2-7 customer tracking: delivery[] non-empty)
"""
import base64
import hashlib
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:3000/api/v1"
STAMP = str(int(time.time()))
SLUG = f"qa-del-{STAMP}"
SALT_KEY = "probe-salt-key-2026"
SALT_INDEX = "1"

results = []


def record(name, ok, detail):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")


def call(method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}


def db_step(cmd, arg):
    out = subprocess.run(
        ["bun", "/home/z/my-project/scripts/phase2/db_step.js", cmd, arg],
        capture_output=True, text=True, timeout=60,
    )
    if out.returncode != 0:
        raise RuntimeError(f"db_step {cmd}: {out.stderr.strip()}")
    return json.loads(out.stdout)


# ── 1. shop + device ─────────────────────────────────────────────────────────
st, reg = call("POST", "/auth/register", {
    "email": f"qa-del-{STAMP}@printshop.test", "password": "Probe-Passw0rd!",
    "name": "QA Delivery Probe", "shopName": f"QA Delivery Shop {STAMP}",
    "phone": "9876543210", "slug": SLUG, "upiId": "qadel@upi",
    "address": "Probe Lane 3", "services": ["bw_print", "color_print"],
    "paymentMethods": "both"})
record("register+shop", st in (200, 201), f"HTTP {st}")

st, login = call("POST", "/auth/login", {
    "email": f"qa-del-{STAMP}@printshop.test", "password": "Probe-Passw0rd!"})
auth = {"Authorization": "Bearer " + ((login.get("data") or {}).get("accessToken") or "")}
record("login", st == 200 and len(auth["Authorization"]) > 30, f"HTTP {st}, jwt={'yes' if len(auth['Authorization']) > 30 else 'no'}")

st, pb = call("POST", "/companion/pairing/begin", None, auth)
st2, pair = call("POST", "/companion/pair", {
    "ticket": (pb.get("data") or {}).get("ticket"),
    "deviceName": f"Delivery-Probe-PC-{STAMP}", "version": "0.6.1", "os": "Windows 11"})
dev_tok = (pair.get("data") or {}).get("deviceToken")
record("pair companion device", st2 == 200 and bool(dev_tok), f"HTTP {st2}")
dev = {"Authorization": f"Bearer {dev_tok}"}

# ── 2. money path (Phase 2's proven format) ─────────────────────────────────
call("PUT", "/shops/me/payment-credentials", {
    "provider": "phonepe", "authVersion": "v1", "merchantId": "DEMO",
    "saltKey": SALT_KEY, "saltIndex": SALT_INDEX, "env": "sandbox"}, auth)

st, order = call("POST", f"/shops/{SLUG}/orders", {"customerPhone": "9876543210", "notes": "delivery probe"})
data = order.get("data") or {}
order_id, cust_tok = data.get("orderId") or data.get("id"), data.get("customerToken")
record("create draft order", st in (200, 201) and bool(order_id and cust_tok), f"HTTP {st}, orderId={str(order_id)[:8]}…")

db_step("seed-file", order_id)

st, checkout = call("POST", f"/orders/{order_id}/checkout", {}, {"X-Order-Token": cust_tok})
record("checkout", st == 200, f"HTTP {st}")

attempt = db_step("get-attempt", order_id)
mo_id = attempt.get("merchantOrderId")
record("attempt persisted", bool(mo_id), f"merchantOrderId={str(mo_id)[:14]}…")
if not mo_id:
    print("VERDICT: no attempt row — aborting"); sys.exit(1)

inner = {"code": "PAYMENT_SUCCESS", "data": {
    "merchantId": "DEMO", "merchantTransactionId": mo_id,
    "transactionId": "TXN-DEL-" + STAMP, "amount": attempt.get("amountPaise"),
    "state": "COMPLETED"}}
b64 = base64.b64encode(json.dumps(inner).encode()).decode()
sig = hashlib.sha256((b64 + SALT_KEY).encode()).hexdigest() + f"###{SALT_INDEX}"
req = urllib.request.Request(BASE + "/payments/phonepe/webhook", data=b64.encode(), method="POST")
req.add_header("Content-Type", "text/plain")
req.add_header("X-VERIFY", sig)
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        wh = r.status
except urllib.error.HTTPError as e:
    wh = e.code
record("signed webhook through production route", wh == 200, f"HTTP {wh}")

status = db_step("get-status", order_id)
record("order paid (paidAt set)", bool(status.get("paidAt")), f"status={status.get('status')}")

# ── 3. device claims the job + posts received ────────────────────────────────
job_id = None
pending_sha = None
for _ in range(10):
    st, pend = call("GET", "/agents/jobs/pending", None, dev)
    rows = (pend.get("data") or {}).get("jobs") or (pend.get("data") or [])
    if rows:
        job_id = rows[0].get("jobId") if isinstance(rows[0], dict) else rows[0]
        pending_sha = rows[0].get("pdfSha256") if isinstance(rows[0], dict) else None
        break
    time.sleep(1)
record("job appears in agent pending queue", bool(job_id), f"HTTP {st}, jobId={str(job_id)[:8]}…")
record("B-010 pending payload carries server-side sha256",
       pending_sha == "afa88fdf67e1fa353c3f5eff06901cfc2238cd72e933f12531af873935fe91b6",
       f"pdfSha256={pending_sha}")

st, cl = call("POST", f"/agents/jobs/{job_id}/status", {"status": "printing"}, dev)
record("agent claims job (printing)", st == 200, f"HTTP {st}")

checksum = hashlib.sha256(b"probe.pdf-bytes").hexdigest()
st, rc = call("POST", f"/agents/jobs/{job_id}/received",
              {"checksum": checksum, "fileSize": 1200}, dev)
# B-010: the server-side stored sha256 EQUALS this checksum (seed fixture),
# so the receipt audit must NOT flag a checksum-mismatch.
data_row = (rc.get("data") or {})
record("agent posts /received (checksum audit pass)",
       st == 200 and data_row.get("received") is True,
       f"HTTP {st}, msg={str(data_row.get('message'))[:70]}")

# ── 4. THE P2-8 PROOF: dashboard delivery history ────────────────────────────
st, hist = call("GET", "/shops/me/deliveries?limit=50", None, auth)
hist_data = hist.get("data")
rows = hist_data if isinstance(hist_data, list) else (hist_data or {}).get("data") or []
match = [r for r in rows
         if r.get("status") == "received"
         and (r.get("fileName") or "").endswith("probe.pdf")
         and f"Delivery-Probe-PC-{STAMP}" in (r.get("deviceName") or "")]
record("P2-8 shops/me/deliveries returns joined history",
       st == 200 and len(match) >= 1,
       f"HTTP {st}, rows={len(rows)}, match={bool(match)}"
       + (f" — file={match[0]['fileName']}, device={match[0]['deviceName']}, mode={match[0]['deliveryMode']}" if match else ""))

# ── 5. THE P2-7 PROOF: customer status payload carries delivery ──────────────
st, stat = call("GET", f"/orders/{order_id}/status", None, {"X-Order-Token": cust_tok})
delivery = ((stat.get("data") or {}).get("delivery")) or []
match2 = [d for d in delivery if d.get("status") == "received" and (d.get("fileName") or "").endswith("probe.pdf")]
record("P2-7 order status carries delivery attempts",
       st == 200 and len(match2) >= 1,
       f"HTTP {st}, delivery rows={len(delivery)}, received-for-probe.pdf={bool(match2)}")

# ── verdict ──────────────────────────────────────────────────────────────────
failed = [r for r in results if not r[1]]
print("\n=== VERDICT ===")
print(f"{len(results) - len(failed)}/{len(results)} checks passed")
if failed:
    for name, _, detail in failed:
        print(f"  FAILED: {name} — {detail}")
    sys.exit(1)
print("DELIVERY SURFACES (P2-7 + P2-8): ALL VERIFIED LIVE")
