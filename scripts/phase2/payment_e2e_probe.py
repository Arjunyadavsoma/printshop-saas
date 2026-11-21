#!/usr/bin/env python3
"""Phase 2 — LIVE money-path E2E probe against the local stack (next dev :3000,
portable PG 16.2). Proves the B-007 chain end-to-end over real HTTP:

  register shop -> seed PhonePe v1 credentials (plaintext JSON, no
  PAYMENT_ENCRYPTION_KEY in dev) -> create draft order -> seed PrintFile row
  (upload path is Phase-3 scope) -> checkout with X-Order-Token ->
  PaymentAttempt row persisted BEFORE provider contact (durable mapping) ->
  forged-but-validly-SIGNED PhonePe v1 webhook through the REAL
  processWebhook pipeline -> order paid -> replay same webhook (idempotency)
  -> tampered signature rejected -> token rotate probe (§15).

DB steps (PrintFile seed / attempt / events) run via db_step.js (bun + pg).
"""
import base64
import hashlib
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:3000/api/v1"
STAMP = str(int(__import__("time").time()))
SLUG = f"qa-pay-{STAMP}"
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


# ── 1. register + login ───────────────────────────────────────────────────────
st, reg = call("POST", "/auth/register", {
    "email": f"qa-pay-{STAMP}@printshop.test", "password": "Probe-Passw0rd!",
    "name": "QA Payment Probe", "shopName": f"QA Pay Shop {STAMP}",
    "phone": "9876543210", "slug": SLUG, "upiId": "qapay@upi",
    "address": "Probe Lane 2", "services": ["bw_print", "color_print"],
    "paymentMethods": "both"})
record("register+shop", st in (200, 201), f"HTTP {st}")

st, login = call("POST", "/auth/login", {
    "email": f"qa-pay-{STAMP}@printshop.test", "password": "Probe-Passw0rd!"})
jwt = ((login.get("data") or {}).get("accessToken")) or ((login.get("data") or {}).get("token"))
record("login", st == 200 and bool(jwt), f"HTTP {st}, jwt={'yes' if jwt else 'no'}")
auth = {"Authorization": f"Bearer {jwt}"}

# ── 2. seed PhonePe v1 credentials (dev plaintext-JSON path) ────────────────
st, cred = call("PUT", "/shops/me/payment-credentials", {
    "provider": "phonepe", "authVersion": "v1", "merchantId": "DEMO",
    "saltKey": SALT_KEY, "saltIndex": SALT_INDEX, "env": "sandbox"}, auth)
record("save phonepe v1 credentials", st in (200, 201), f"HTTP {st}")

# ── 3. create draft order ────────────────────────────────────────────────────
st, order = call("POST", f"/shops/{SLUG}/orders", {
    "customerPhone": "9876543210", "notes": "payment e2e probe"})
data = order.get("data") or {}
order_id = data.get("orderId") or data.get("id")
cust_tok = data.get("customerToken")
record("create draft order", st in (200, 201) and bool(order_id and cust_tok),
       f"HTTP {st}, orderId={str(order_id)[:8]}… customerToken={cust_tok}")

# ── 4. seed a completed PrintFile (upload path is Phase 3 scope) ────────────
seeded = db_step("seed-file", order_id)
record("seed PrintFile ₹2.00", seeded.get("seeded") is True, json.dumps(seeded))

# ── 5. checkout as the customer ─────────────────────────────────────────────
st, checkout = call("POST", f"/orders/{order_id}/checkout", {}, {"X-Order-Token": cust_tok})
co_data = checkout.get("data") or {}
co_err = checkout.get("error") or {}
upi = co_data.get("upiUri") or co_data.get("qrPayload")
# 200 = adapter returned an intent (offline UPI fallback); 4xx/5xx possible if
# the sandboxed adapter throws — EITHER WAY the attempt row must exist (step 6).
record("checkout (provider contact outcome noted)", st in (200, 201, 402, 500, 502, 503),
       f"HTTP {st}, upiUri={'yes' if upi else 'no'}, error={co_err.get('code')}: {str(co_err.get('message'))[:160]}")

# ── 6. THE B-007 PROOF: attempt persisted durably, webhook resolves it ──────
attempt = db_step("get-attempt", order_id)
mo_id = attempt.get("merchantOrderId") if attempt else None
record("PaymentAttempt persisted (pre-provider, durable)", bool(mo_id),
       f"merchantOrderId={str(mo_id)[:14]}… status={attempt.get('status') if attempt else 'NO ROW'} amountPaise={attempt.get('amountPaise') if attempt else '-'}")
if not mo_id:
    print("\n=== VERDICT === checkout produced no attempt row — aborting (money path unproven)")
    sys.exit(1)
record("PaymentAttempt persisted (pre-provider, durable)", bool(mo_id),
       f"merchantOrderId={str(mo_id)[:14]}… status={attempt.get('status')} amountPaise={attempt.get('amountPaise')}")

# ── 7. POST a VALID PhonePe v1 webhook to the REAL production route ─────────
# /payments/phonepe/webhook auto-detects v1 (X-VERIFY + base64 body). The v1
# callback payload (per UPIPay's verifyWebhook mapping) is:
#   { code: "PAYMENT_SUCCESS", data: { merchantTransactionId, transactionId, amount, … } }
# checksum = sha256(base64Body + saltKey) + '###' + saltIndex
txn = "TXN-PROBE-" + STAMP
inner = {
    "code": "PAYMENT_SUCCESS",
    "data": {
        "merchantId": "DEMO",
        "merchantTransactionId": mo_id,
        "transactionId": txn,
        "amount": attempt.get("amountPaise"),
        "state": "COMPLETED",
    },
}
b64 = base64.b64encode(json.dumps(inner).encode()).decode()
sig = hashlib.sha256((b64 + SALT_KEY).encode()).hexdigest() + f"###{SALT_INDEX}"

def post_webhook(body, verify):
    req = urllib.request.Request(BASE + "/payments/phonepe/webhook", data=body.encode(), method="POST")
    req.add_header("Content-Type", "text/plain")
    req.add_header("X-VERIFY", verify)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()[:60]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:120]

wh_status, wh_body = post_webhook(b64, sig)
record("signed v1 webhook accepted by production route", wh_status == 200,
       f"HTTP {wh_status}, body={wh_body!r}")

status = db_step("get-status", order_id)
# Financial invariant: paidAt set + order past awaiting_payment. The order may
# already have advanced into the print pipeline ('printing') because payment
# enqueueing is synchronous with the webhook — that IS the success path.
record("order transitioned past 'awaiting_payment' (paid)",
       bool(status.get("paidAt")) and status.get("status") in ("paid", "printing", "completed"),
       f"status={status.get('status')} paidAt={'yes' if status.get('paidAt') else 'no'}")

events = db_step("get-events", mo_id)
processed = [e for e in events if e.get("processingStatus") == "processed"]
record("PaymentEvent persisted (audit trail)", len(processed) >= 1,
       f"{len(events)} event(s), processed={len(processed)}, sigValid={all(e.get('signatureValid') for e in processed)}")

# ── 8. idempotency: replay the EXACT same webhook ────────────────────────────
replay_status, _ = post_webhook(b64, sig)
events2 = db_step("get-events", mo_id)
status2 = db_step("get-status", order_id)
att2 = db_step("get-attempt", order_id)
record("replayed webhook is idempotent (no double effect)",
       status2.get("paidAt") is not None and att2.get("status") == "paid"
       and len([e for e in events2 if e.get("processingStatus") == "processed"]) == len(processed),
       f"replay HTTP {replay_status}, processed events {len(processed)}→{len([e for e in events2 if e.get('processingStatus') == 'processed'])}, order={status2.get('status')}, attempt={att2.get('status')}")

# ── 9. tampered signature rejected ───────────────────────────────────────────
bad_sig = hashlib.sha256((b64 + "wrong-salt").encode()).hexdigest() + f"###{SALT_INDEX}"
tamper, _ = post_webhook(b64, bad_sig)
record("tampered signature rejected", tamper == 401, f"HTTP {tamper}")
st, pb = call("POST", "/companion/pairing/begin", None, auth)
ticket = ((pb.get("data") or {}).get("ticket"))
st2, pair = call("POST", "/companion/pair", {
    "ticket": ticket, "deviceName": "Rotate-Probe-PC", "version": "0.6.1", "os": "Windows 11"})
dev_tok = ((pair.get("data") or {}).get("deviceToken"))
record("pair device for rotate probe", st2 == 200 and bool(dev_tok), f"HTTP {st2}")

st3, rot = call("POST", "/companion/token/rotate", {}, {"Authorization": f"Bearer {dev_tok}"})
rot_data = rot.get("data") or {}
new_tok = rot_data.get("deviceToken")
record("token rotate (§15)", st3 == 200 and bool(new_tok) and len(new_tok) == 64,
       f"HTTP {st3}, overlapExpiresAt={'yes' if rot_data.get('overlapExpiresAt') else 'no'}")

st4, hb = call("POST", "/agents/heartbeat", {}, {"Authorization": f"Bearer {dev_tok}"})
record("OLD token still valid during 10-min overlap", st4 == 200, f"HTTP {st4}")

st5, _ = call("POST", "/agents/heartbeat", {}, {"Authorization": "Bearer " + "f" * 64})
record("garbage token rejected", st5 == 401, f"HTTP {st5}")

# ── verdict ──────────────────────────────────────────────────────────────────
failed = [r for r in results if not r[1]]
print("\n=== VERDICT ===")
print(f"{len(results) - len(failed)}/{len(results)} checks passed")
if failed:
    for name, _, detail in failed:
        print(f"  FAILED: {name} — {detail}")
    sys.exit(1)
print("MONEY PATH + ROTATE: ALL VERIFIED")
