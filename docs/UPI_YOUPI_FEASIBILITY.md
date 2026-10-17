# YouPI-PG Feasibility Report — PrintShop SaaS Integration Audit

> Audited: 2026-10-17
> Source: https://github.com/gxurav1710/YouPI-PG (commit 242969c)
> Auditor: PrintShop SaaS engineering

---

## A. Licensing — BLOCKER

| Item | Finding |
|---|---|
| LICENSE file | **DOES NOT EXIST** — `find . -iname 'license*'` returns nothing |
| `package.json` license field | `"license": "Commercial"` |
| README claim | "Distributed under commercial and sovereign licensing" — but no actual license text |
| Default copyright | Without a LICENSE file, default copyright applies: **all rights reserved** |
| Commercial SaaS use | **NOT PERMITTED** without explicit written permission from the copyright holder |
| Modification | **NOT PERMITTED** |
| Redistribution | **NOT PERMITTED** |
| White-label integration | Claimed in README but no legal basis — no license file |
| Attribution obligations | Unknown — no license to reference |

**Conclusion: BLOCKED by licensing.** The repository has no LICENSE file. The `package.json` declares "Commercial" but provides no terms. Under default copyright law, the code cannot be legally used, modified, copied, or integrated into PrintShop without explicit written permission from the copyright holder. **Do not copy any code from this repository.**

---

## B. Architecture and Hosting

### Processes required (7+ services)

| Service | Port | Must run 24/7? | Serverless-compatible? |
|---|---|---|---|
| payment-api | 6100 | Yes | No (SQLite WAL, in-memory timers) |
| checkout-portal | 7000 | Yes | No (SSE, stateful sessions) |
| merchant-admin | 6001 | No (admin panel) | Partially |
| control-center | 8090 | Yes (process manager) | No |
| gmail-observer | 6003 | Yes (continuous polling) | No |
| sms-observer | 6002 | Yes (continuous polling) | No |
| coin-wallet-store | 5000 | No (demo store) | Partially |
| Android observer app | N/A | Yes (on a phone) | N/A |

### Key infrastructure dependencies

- **SQLite WAL** (`node:sqlite` `DatabaseSync`) — not PostgreSQL; no connection pooling
- **Android device** with `RECEIVE_SMS`, `READ_SMS`, `WAKE_LOCK`, `FOREGROUND_SERVICE` permissions — must be always-on
- **Gmail OAuth** — requires Google Cloud Console setup with Gmail API scope
- **WhatsApp Baileys** (Berry Protocol) — unofficial WhatsApp multi-device library; against WhatsApp Terms of Service
- **Chrome/CDP** — the gmail-observer and sms-observer use browser automation (`browser-automator.js`)

### Serverless compatibility

**NOT COMPATIBLE.** YouPI-PG requires:
- Persistent in-memory timers (5-min payment window, 30-sec verification window)
- Continuous polling loops (gmail, sms)
- An always-on Android device
- SQLite WAL (not serverless-friendly)
- WhatsApp multi-device socket (persistent connection)

A free Render/Fly.io always-on instance could host the Node.js services, but the Android device + WhatsApp session are additional infrastructure.

---

## C. Payment Lifecycle

### Flow

1. Merchant creates a payment session → customer sees a UPI QR
2. Customer pays via UPI → money goes to the merchant's VPA
3. Bank sends an SMS to the merchant's registered phone → Android observer captures it
4. OR: Bank sends a Gmail notification → Gmail observer polls and captures it
5. The observation is parsed (amount extracted from SMS/Gmail text via regex)
6. Attribution: the parsed amount is matched to the active payment session's expected amount
7. If matched → session transitions to SUCCESS → webhook dispatched

### What proves payment occurred?

**Bank SMS or Gmail notification parsing.** Not a cryptographic API, not a bank API, not a UPI verification API. The system parses free-text SMS/Gmail messages using regex to extract amounts and bank reference numbers.

### Critical limitations

| Concern | Finding |
|---|---|
| Amount-only attribution | Payment is attributed by matching the observed amount to the expected amount. UTR/reference numbers are stored but not used for matching. |
| Concurrent identical-amount payments | **Serialization** — only one active session per VPA at a time. Additional customers are queued (FIFO). This makes the system unsuitable for a multi-shop SaaS with concurrent orders. |
| SMS spoofing | SMS can be spoofed. A crafted SMS with the right amount and format could falsely confirm a payment. The system has fraud pattern detection (regex-based) but this is not cryptographically strong. |
| Gmail delay | Gmail notifications can be delayed by minutes. The 30-second verification window may expire before the Gmail arrives. |
| No UPI status API | YouPI-PG does not call any UPI verification API (UPI Collect, BHIM, or bank PSP API). It relies entirely on SMS/Gmail observation. |
| UTR uniqueness | Bank reference numbers are stored in observations but attribution is by amount only. If two payments of the same amount arrive, the system cannot distinguish them — hence the single-active-slot constraint. |
| Refunds | No refund mechanism. |
| Replay protection | Observation fingerprints are computed (`calculateObservationFingerprint`) but the attribution engine uses amount matching, not fingerprint uniqueness. |

### Distinguishing simultaneous payments with identical amounts

**Cannot.** The architecture explicitly states (Invariant 2): "Exactly ONE customer payment session can occupy an ACTIVE or PROCESSING state on a given receiving VPA at any instant." This is a workaround for the inability to distinguish identical-amount payments.

For PrintShop (a multi-tenant SaaS with multiple shops and concurrent orders), this constraint is **operationally fatal** — only one order can be paid at a time per VPA.

---

## D. Security and Privacy

### Android observer app permissions

```xml
RECEIVE_SMS, READ_SMS, RECEIVE_BOOT_COMPLETED, WAKE_LOCK,
FOREGROUND_SERVICE, FOREGROUND_SERVICE_DATA_SYNC,
REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, POST_NOTIFICATIONS,
CAMERA, VIBRATE, INTERNET, ACCESS_NETWORK_STATE
```

**Risk:** `READ_SMS` grants full access to ALL SMS on the device — not just bank SMS. This includes OTPs, personal messages, and any other SMS. The app runs 24/7 in the foreground.

### Gmail observer

- Requires OAuth with Gmail API scope (`gmail.readonly` or similar)
- Polls the shop owner's entire inbox
- Parses bank notification emails via regex
- **Risk:** Full read access to the shop owner's Gmail — all emails, not just bank notifications

### WhatsApp Baileys (Berry Protocol)

- Uses an unofficial WhatsApp multi-device library
- **Violates WhatsApp Terms of Service** — accounts may be banned
- Used for customer "OTP" authentication before payment

### Credential storage

- `ENCRYPTION_MASTER_KEY` (256-bit hex) encrypts OAuth tokens and device keys
- Webhook secrets are generated per-merchant
- Session JWT uses a separate `JWT_SECRET`
- **However:** the SMS/Gmail observers transmit parsed payment data to the payment-api over HTTP — if not behind TLS, this is interceptable

### Logging

- Raw SMS/Gmail payloads are stored in `payment_observations.raw_payload` (JSON)
- Bank reference numbers and sender VPAs are stored
- **Risk:** Full bank SMS text (which may contain account numbers, balances, etc.) is persisted

---

## E. Multi-Tenant Suitability

| Requirement | Supported? | Evidence |
|---|---|---|
| Separate UPI IDs/VPAs per shop | ✅ Yes | `payment_receiving_accounts` table has `merchant_id` FK; each merchant has their own VPA |
| Separate merchant config + credentials | ✅ Yes | `merchants` table with per-merchant `webhook_url`, `webhook_secret`, `branding` |
| Shop-specific payment sessions | ✅ Yes | `payment_sessions` table has `merchant_id` FK |
| Strict tenant isolation | ⚠️ Partial | Schema has merchant_id FKs, but the observer infrastructure (SMS/Gmail) is shared per-deployment |
| Independent reconciliation | ✅ Yes | Per-merchant webhook delivery with HMAC signing |
| Multiple concurrent payments | ❌ **NO** | Single-active-slot constraint: only one active session per VPA at a time |
| Wrong-account payment handling | ❌ **NO** | If a payment goes to the wrong VPA, the system cannot detect it — attribution is amount-only |

**Multi-tenant conclusion:** The schema supports multiple merchants, but the **single-active-slot constraint** makes it unsuitable for a multi-shop SaaS where multiple shops may have concurrent orders. Each shop would need its own YouPI-PG deployment with its own Android device and Gmail account.

---

## F. Recommendation

### Classification: **Unsuitable for integration without upstream changes**

**Primary blockers:**

1. **No LICENSE file** — legal blocker. Cannot use, modify, or integrate the code without explicit permission.
2. **Amount-only attribution** — cannot distinguish concurrent payments of the same amount. Operationally fatal for a multi-shop SaaS.
3. **Single-active-slot constraint** — only one payment at a time per VPA. Customers would queue.
4. **No cryptographic payment verification** — relies on SMS/Gmail parsing which can be spoofed.
5. **Android SMS observer** — requires a dedicated always-on Android device with full SMS access per shop. Not scalable.
6. **WhatsApp Baileys** — unofficial, against ToS, accounts may be banned.
7. **Gmail OAuth** — requires full inbox read access per shop owner.
8. **Not serverless-compatible** — requires always-on processes + Android device.

### Could it be used as a QR-only/manual-confirmation flow?

**Risky and not recommended.** Even as a manual-confirmation flow:
- The shopkeeper would still need an Android device with the observer app running
- SMS parsing could produce false positives (wrong amount, wrong format)
- No UPI status API fallback means there's no authoritative verification
- The customer could claim payment without actually paying (the "payment done" button is client-side)

PrintShop's existing UPI deep-link adapter already generates `upi://` QR codes. YouPI-PG offers no advantage over the existing approach without the observation infrastructure, and the observation infrastructure is unsuitable for production multi-tenant use.

### What would make it viable?

The following upstream changes would be needed:
1. A proper open-source LICENSE (MIT/Apache 2.0)
2. Integration with a real UPI verification API (UPI Collect, BHIM, or bank PSP)
3. Removal of the single-active-slot constraint (via UTR-based matching instead of amount-only)
4. Removal of the WhatsApp Baileys dependency
5. Serverless-compatible architecture (or a documented always-on hosting plan)

None of these are within PrintShop's control.

---

## G. Integration Architecture (if viable — NOT RECOMMENDED)

If the blockers were resolved, the adapter would:

1. Implement `PaymentAdapter` from `@platform/core/interfaces`
2. `createPaymentIntent`: call YouPI-PG's `POST /api/v1/payments` → get checkout URL + QR
3. `handleWebhook`: verify YouPI-PG's HMAC-signed webhook → extract paymentId, orderId, amount
4. Amount validation: compare the webhook's amount to PrintShop's persisted `totalAmountPaise`
5. Idempotency: use YouPI-PG's `idempotency_key` + PrintShop's `paymentTxnId` UNIQUE constraint

**However, this integration is NOT RECOMMENDED** due to the blockers above. PrintShop should:
- Keep the existing PhonePe/Paytm adapters (which use real cryptographic verification)
- Keep the UPI deep-link adapter (which is honest about its limitations — no verification, order stays pending)
- Not integrate YouPI-PG

---

## H. Summary

| Dimension | Verdict |
|---|---|
| Licensing | ❌ BLOCKER — no LICENSE file |
| Architecture | ❌ Not serverless; requires always-on + Android device |
| Payment verification | ❌ SMS/Gmail parsing — not cryptographically trustworthy |
| Concurrent payments | ❌ Single-active-slot — one payment at a time per VPA |
| Multi-tenant | ❌ Observers are per-deployment, not per-shop |
| Security | ❌ Full SMS access, Gmail inbox access, WhatsApp ToS violation |
| Integration recommendation | **Do not integrate.** |
