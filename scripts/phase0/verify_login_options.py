#!/usr/bin/env python3
"""Live end-to-end verification of every PrintEXE login option against the
production SaaS (https://printshop-saas-three.vercel.app).

Verifies exactly what the app does, option by option:
  1. Legacy email+password  -> register -> login -> /auth/me (session flow)
  2. Pairing ticket         -> /companion/pairing/begin -> /companion/pair -> /agents/heartbeat
  3. Paste device token     -> /agents/heartbeat with a raw token (PairWithDeviceTokenAsync's
                               validation mechanism: set token -> heartbeat -> persist)

Prints a verdict table; exit 0 only if every option passes.
"""
import json
import os
import time
import urllib.request
import urllib.error

BASE = os.environ.get("PSA_BASE", "https://printshop-saas-three.vercel.app/api/v1")
STAMP = str(int(time.time()))
EMAIL = f"qa-login-{STAMP}@printshop.test"
PASSWORD = "TestPass123!"
results = []


def call(method, path, body=None, token=None, label=""):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            payload = json.loads(r.read().decode() or "{}")
            return r.status, payload
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode() or "{}")
        except Exception:
            payload = {}
        return e.code, payload
    except Exception as e:  # network failure
        return -1, {"error": str(e)}


def record(option, step, ok, detail):
    results.append((option, step, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {step}: {detail}")


print(f"=== Live login-option verification @ {time.strftime('%Y-%m-%d %H:%M:%S')} ===")
print(f"Test account: {EMAIL}\n")

# ── Option 1: legacy email + password ────────────────────────────────────
print("[1] LEGACY EMAIL + PASSWORD")
st, reg = call("POST", "/auth/register", {
    "email": EMAIL, "password": PASSWORD,
    "name": "QA Login Check", "shopName": f"QA Shop {STAMP}",
    "phone": "9876543210", "slug": f"qa-shop-{STAMP}",
    "upiId": "qashop@upi", "address": "QA Test Address 1",
    "services": ["bw_print", "color_print"], "paymentMethods": "both"})
if st in (200, 201):
    record("legacy", "register", True, f"HTTP {st}, account created")
elif st == 409:
    record("legacy", "register", True, "already exists (idempotent path)")
else:
    record("legacy", "register", False, f"HTTP {st}: {json.dumps(reg)[:160]}")

st, login = call("POST", "/auth/login", {"email": EMAIL, "password": PASSWORD})
ok = st == 200 and (login.get("data") or {}).get("accessToken")
record("legacy", "login", bool(ok),
       f"HTTP {st}" + (f", user={login['data']['user']['email']}, shopId set={bool(login['data']['user'].get('shopId'))}" if ok else f": {json.dumps(login)[:160]}"))

access = (login.get("data") or {}).get("accessToken", "")
user = (login.get("data") or {}).get("user", {})
st, me = call("GET", "/me", token=access)
me_ok = st == 200 and ((me.get("data") or {}).get("email", me.get("data", {}).get("user", {}).get("email", "")) or "").lower() == EMAIL.lower()
record("legacy", "me (session valid)", me_ok,
       f"HTTP {st}" + (f", /me -> {json.dumps(me.get('data'))[:120]}" if st == 200 else f": {json.dumps(me)[:160]}"))

# wrong password must be a clean 401 (not 500) — the user-facing error path
st, bad = call("POST", "/auth/login", {"email": EMAIL, "password": "wrong-password"})
record("legacy", "wrong password -> clean 401", st == 401 and (bad.get("error") or {}).get("code") == "UNAUTHORIZED",
       f"HTTP {st}, code={(bad.get('error') or {}).get('code')}")

# ── Option 2: pairing ticket (v1 contract flow) ──────────────────────────
print("\n[2] PAIRING TICKET")
st, begin = call("POST", "/companion/pairing/begin", token=access)
ticket = (begin.get("data") or {}).get("ticket") or (begin.get("data") or {}).get("pairingTicket") or ""
record("ticket", "pairing/begin", st == 200 and len(ticket) == 64,
       f"HTTP {st}, ticket len={len(ticket)}" + ("" if st == 200 else f": {json.dumps(begin)[:160]}"))

st, pair = call("POST", "/companion/pair", {
    "ticket": ticket, "deviceName": "QA-VERIFY-PC",
    "version": "0.4.7", "os": "win32", "printerName": "QA Virtual Printer"})
pdata = pair.get("data") or {}
device_token = pdata.get("deviceToken") or ""
record("ticket", "companion/pair", st == 200 and bool(device_token),
       f"HTTP {st}, shop={pdata.get('shopName')}, token minted={bool(device_token)}"
       + ("" if st == 200 else f": {json.dumps(pair)[:160]}"))

st, hb = call("POST", "/agents/heartbeat", token=device_token,
              body={"printerName": "QA Virtual Printer", "version": "0.4.7", "os": "win32"})
record("ticket", "device heartbeat", st == 200,
       f"HTTP {st}" + ("" if st == 200 else f": {json.dumps(hb)[:160]}"))

# ticket must be single-use
st, reuse = call("POST", "/companion/pair", {
    "ticket": ticket, "deviceName": "QA-REUSE-PC", "os": "win32"})
code = (reuse.get("error") or {}).get("code")
record("ticket", "ticket single-use enforced", st in (401, 409, 410) and code in ("PAIRING_TICKET_CONSUMED", "PAIRING_TICKET_UNAVAILABLE", "UNAUTHORIZED"),
       f"HTTP {st}, code={code}")

# ── Option 3: paste device token (legacy fallback) ───────────────────────
print("\n[3] PASTE DEVICE TOKEN")
# The app's PairWithDeviceTokenAsync validates by heartbeat with the pasted
# token. A freshly paired token (above) is exactly what a shopkeeper would
# copy out of the dashboard, so validate a heartbeat with it as-is.
st, hb2 = call("POST", "/agents/heartbeat", token=device_token,
               body={"printerName": "QA Virtual Printer", "version": "0.4.7", "os": "win32"})
record("paste-token", "heartbeat with pasted token", st == 200,
       f"HTTP {st} (mechanism the app uses to validate a pasted token)")

# a garbage token must be rejected cleanly
st, garbage = call("POST", "/agents/heartbeat", token="garbage-token-not-real",
                   body={"printerName": "x", "version": "0.4.7", "os": "win32"})
record("paste-token", "garbage token rejected", st == 401,
       f"HTTP {st}, code={(garbage.get('error') or {}).get('code')}")

# ── Cross-device sync chain: order → device snapshot → commands ──────────
print("\n[4] CROSS-DEVICE SYNC (management across devices)")
slug = f"qa-shop-{STAMP}"

# A customer places an order on the web (no auth).
st, order = call("POST", f"/shops/{slug}/orders", {"customerPhone": "9876543210", "notes": "QA sync test"})
odata = order.get("data") or {}
order_id = odata.get("order", {}).get("id") if isinstance(odata.get("order"), dict) else odata.get("id") or odata.get("orderId")
record("sync", "customer creates order (web)", st in (200, 201) and bool(order_id),
       f"HTTP {st}, orderId={order_id}" + ("" if st in (200, 201) else f": {json.dumps(order)[:160]}"))

# The PAIRED device (no shopkeeper session!) pulls its shop snapshot — the
# Universal-Print-model read path added for paired-only companions.
st, snap = call("GET", "/companion/shop-snapshot", token=device_token)
sdata = snap.get("data") or {}
snap_orders = sdata.get("orders") or []
in_snapshot = any(o.get("id") == order_id for o in snap_orders)
record("sync", "device snapshot contains the new order", st == 200 and in_snapshot,
       f"HTTP {st}, shop={sdata.get('shop', {}).get('name')}, orders in snapshot={len(snap_orders)}, new order visible={in_snapshot}")
# shapes must match what the app's mappers parse
shape_ok = (isinstance(sdata.get("shop"), dict) and "name" in sdata["shop"]
            and all(k in o for o in snap_orders[:1] for k in ("id", "status", "totalAmountPaise", "createdAt"))
            if snap_orders else isinstance(sdata.get("shop"), dict))
record("sync", "snapshot shapes match app DTOs", bool(shape_ok),
       "shop.name + order{id,status,totalAmountPaise,createdAt} present" if shape_ok else f"unexpected shape: {json.dumps(sdata)[:160]}")
# a session token must NOT be required — and a garbage token must be rejected
st, snap_bad = call("GET", "/companion/shop-snapshot", token="garbage")
record("sync", "snapshot rejects garbage device token", st == 401, f"HTTP {st}")

# The shopkeeper issues a remote command from the web dashboard.
agent_id = pdata.get("agentId") or ""
st, cmd = call("POST", f"/shops/me/devices/{agent_id}/commands", token=access,
               body={"commandType": "refresh_printers"})
cdata = cmd.get("data") or {}
command_id = cdata.get("command", {}).get("id") if isinstance(cdata.get("command"), dict) else cdata.get("id") or cdata.get("commandId")
record("sync", "web issues refresh_printers command", st in (200, 201),
       f"HTTP {st}, commandId={command_id}" + ("" if st in (200, 201) else f": {json.dumps(cmd)[:160]}"))

# The device polls companion/commands (exactly what CommandPoller does).
st, cmds = call("GET", "/companion/commands", token=device_token)
cmd_list = (cmds.get("data") or {}).get("commands") or (cmds.get("data") or [])
arrived = any(c.get("commandId") == command_id for c in cmd_list) if command_id else False
record("sync", "device command poll sees it", st == 200 and arrived,
       f"HTTP {st}, {len(cmd_list)} pending command(s), target command present={arrived}")

# The device acknowledges the command (POST /companion/commands).
if command_id:
    st, ack = call("POST", "/companion/commands", token=device_token,
                   body={"commandId": command_id, "status": "delivered"})
    record("sync", "device acknowledges command", st == 200,
           f"HTTP {st}" + ("" if st == 200 else f": {json.dumps(ack)[:160]}"))

# Device pending-jobs endpoint (the print agent's queue feed) is reachable.
st, jobs = call("GET", "/agents/jobs/pending", token=device_token)
record("sync", "device pending-jobs feed reachable", st == 200,
       f"HTTP {st}, jobs={len((jobs.get('data') or {}).get('jobs') or (jobs.get('data') or []))}")

# ── Verdict ───────────────────────────────────────────────────────────────
print("\n=== VERDICT ===")
options = {}
for option, step, ok, _ in results:
    options.setdefault(option, True)
    if not ok:
        options[option] = False
for option, ok in options.items():
    print(f"  {option:12s} -> {'WORKS' if ok else 'BROKEN'}")
failed = [o for o, ok in options.items() if not ok]
print(f"\nExit: {'ALL OPTIONS VERIFIED' if not failed else 'FAILED: ' + ', '.join(failed)}")
raise SystemExit(1 if failed else 0)
