# PrintShop Payment Setup Guide

This guide walks **shopkeepers** through registering with a payment provider and
configuring their shop, and walks **developers** through the encryption,
webhook, and environment-variable plumbing that makes it work.

> **Audience:** PrintShop shopkeepers (sections 2–5, 8) and PrintShop
> developers/operators (sections 1, 6, 7, 9, 10).

---

## 1. Architecture

### 1.1 End-to-end payment flow

```
Customer → Checkout → Provider (PhonePe/Paytm) → Webhook → Verify → Print
                ↑                                          ↑
                └── UPI deep-link / QR fallback ─── Manual verify by shopkeeper
```

1. **Customer** places an order at checkout.
2. The PrintShop backend calls the active **payment provider** (PhonePe or
   Paytm) on the shop's behalf, using that shop's encrypted credentials, and
   receives a `checkoutUrl`.
3. The customer is redirected to the provider's payment page (or shown a
   UPI deep-link / QR if the shop has no merchant API configured).
4. After payment, the provider sends a **webhook** to PrintShop.
5. PrintShop **verifies** the webhook signature, flips the order from
   `awaiting_payment` → `paid`, and (optionally) re-checks the transaction
   status via the provider's status API as defense-in-depth.
6. The order becomes printable.

### 1.2 The payment adapter registry

PrintShop ships three payment adapters in `packages/adapters/src/payment/`:

| Adapter | Provider key | Auth | Automatic verification? |
| --- | --- | --- | --- |
| `PhonePePaymentAdapter` | `phonepe` | v1 saltKey/saltIndex **or** v2 OAuth2 (clientId/clientSecret) | Yes (webhook + status API) |
| `PaytmPaymentAdapter` | `paytm` | merchantId + merchantKey (standard) | Yes (callback + status API) |
| UPI deep-link / QR | `googlepay` | None (just the shop's UPI ID) | No — shopkeeper marks paid manually |

The active adapter for a shop is selected by the shop's `paymentProvider`
field. The adapter receives the shop's decrypted credentials on every call —
there is **no global merchant account**.

### 1.3 Multi-tenant credentials

Each shop owns its own `paymentCredentials` JSON blob, stored **encrypted at
rest** in the database (see §6). Credentials for both providers can coexist on
the same shop; only one is "active" at a time (`paymentProvider` field). When a
shopkeeper disconnects their active provider, PrintShop automatically falls back
to `googlepay` (UPI deep-link) so the shop can keep accepting payments via QR +
manual verification.

---

## 2. PhonePe Merchant Registration

**Register at:** <https://business.phonepe.com/>

### 2.1 Create a merchant account + complete KYC

1. Sign up at <https://business.phonepe.com/> using your business email.
2. Complete business onboarding — provide your legal entity name, PAN, GSTIN
   (if applicable), and bank account details.
3. Complete **KYC** as prompted by PhonePe (typically entity verification +
   bank-account penny-drop verification).
4. Once your account is approved, locate the **API integration / Developers**
   section in the PhonePe Business dashboard to retrieve your API credentials.

> We deliberately do not enumerate exact dashboard menu names — PhonePe's
> dashboard layout changes over time. Look for "API", "Developers",
> "Integration", or "Keys" in your PhonePe Business dashboard, or consult
> PhonePe's official developer documentation linked from the dashboard.

### 2.2 Get API credentials

PhonePe exposes **two** API authentication schemes. PrintShop supports both and
auto-detects which one you've configured:

#### v1 — Standard API (legacy but widely supported)

Fields required by PrintShop:

| Field | Description |
| --- | --- |
| `merchantId` | Your PhonePe Merchant ID (e.g. `MID...`) |
| `saltKey` | A secret key string used to sign requests |
| `saltIndex` | Numeric index of the salt key (usually `1`) |

The adapter uses the [UPIPay](https://www.npmjs.com/package/upipay) SDK to call
the v1 endpoints (`/pg/v1/pay`, `/pg/v1/status`, `/pg/v1/refund`). Webhook
verification uses the **X-VERIFY** header format:
`sha256(base64(body) + saltKey) + "###" + saltIndex`.

API host: `https://api.phonepe.com/apis/hermes` (prod) /
`https://api-preprod.phonepe.com/apis/hermes` (sandbox).

#### v2 — Business API (OAuth2)

Fields required by PrintShop:

| Field | Description |
| --- | --- |
| `merchantId` | Your PhonePe Merchant ID (separate from `clientId`) |
| `clientId` | OAuth2 client ID issued by PhonePe |
| `clientSecret` | OAuth2 client secret |
| `clientVersion` | API client version string (typically `1`) |

The adapter implements the OAuth2 client-credentials flow directly: it POSTs
`client_id`, `client_secret`, `client_version`, and `grant_type=client_credentials`
to `/oauth/v1/token`, caches the bearer access token in-process (refreshing 60s
before expiry; tokens typically last 10 minutes), and uses it as a
`Authorization: Bearer <token>` header on v2 API calls:

- `POST /pg/v2/pay` — create payment
- `GET  /pg/v2/status/{merchantId}/{merchantTransactionId}` — check status
- `POST /pg/v2/refund` — refund

> **Why two versions?** v1 (Standard API) is the original checksum-based
> scheme; v2 (Business API) is the newer OAuth2-based scheme PhonePe is
> steering merchants toward. Both are fully supported by PrintShop. If your
> PhonePe dashboard issues you `clientId` / `clientSecret`, configure v2 —
> otherwise fall back to v1 with `saltKey` / `saltIndex`.

> The webhook callback **X-VERIFY** signature format is shared between v1 and
> v2 callbacks. For v2 merchants (no `saltKey`), PrintShop decodes the
> base64 payload directly and uses the v2 **status API** as the
> authoritative signature/amount check (defense-in-depth, since the webhook
> arrived over authenticated HTTPS).

### 2.3 Pick a sandbox vs production environment

Each credential set carries an `env` field (`sandbox` | `prod`). PrintShop uses
this to select the correct PhonePe host. Always start in `sandbox`, run the
Test Connection (§4.2) and a dev simulation (§4.3), then switch to `prod` once
everything works.

---

## 3. Paytm Merchant Registration

**Register at:** <https://dashboard.paytm.com/>

### 3.1 Create a merchant account

1. Sign up at <https://dashboard.paytm.com/> with your business email.
2. Complete business KYC (PAN, GSTIN if applicable, bank account).
3. Once approved, locate the **API / Developers / Integration** section in the
   Paytm Business dashboard to retrieve your Merchant ID and Merchant Key.

> As with PhonePe, do not rely on exact menu names — locate the API integration
> section in your Paytm dashboard. Official Paytm developer documentation lives
> at <https://business.paytm.com/docs/>.

### 3.2 Get API credentials

Paytm uses a single authentication scheme. Fields required by PrintShop:

| Field | Sandbox value | Production value |
| --- | --- | --- |
| `merchantId` | Your sandbox Merchant ID | Your production Merchant ID |
| `merchantKey` | Your sandbox Merchant Key | Your production Merchant Key |
| `website` | `WEBSTAGING` | `DEFAULT` |
| `industryType` (optional) | e.g. `Retail` | e.g. `Retail` |
| `channelId` (optional) | `WEB` (desktop) or `WAP` (mobile) | `WEB` or `WAP` |
| `env` | `sandbox` | `prod` |

The adapter uses the UPIPay SDK to call the Paytm APIs:

- `POST /v3/order/initiate` (initiateTransaction) → checkout URL with a transaction token
- `POST /v3/order/status` — status check
- `POST /v3/order/refund` — refund

Webhook verification uses the **CHECKSUMHASH** field: AES-128-CBC over
`sha256(sorted(params)|merchantKey)`.

---

## 4. Sandbox Setup

### 4.1 Configure sandbox credentials in PrintShop

1. Sign in to your PrintShop shop dashboard.
2. Open **Settings → Payment Provider** (or equivalent payment settings page).
3. Select your provider (PhonePe or Paytm).
4. Paste the **sandbox** credentials you obtained in §2 / §3.
5. Set `env` = `sandbox`.
6. Click **Save**.

The credentials are sent via `PUT /api/v1/shops/me/payment-credentials`,
validated server-side with Zod, encrypted at rest (§6), and stored in the
shop's `paymentCredentials` blob. The response returns only **masked** values
(see §6.4).

### 4.2 The Test Connection feature

After saving credentials, the payment settings panel exposes a **Test
Connection** action. Use it to verify your saved credentials can authenticate
against the provider's sandbox API before placing a real test order. The test
exercises the same authentication path used by real checkouts (PhonePe v1 salt
checksum, PhonePe v2 OAuth2 token, or Paytm checksum) and reports back whether
the credentials authenticated successfully.

If the test fails, double-check the credential values and the `env` setting.

### 4.3 Simulate payments in sandbox

PrintShop ships **dev-only** simulation routes that sign a provider-format
callback with your shop's sandbox credentials and feed it through the *real*
`processWebhook` pipeline (signature verify → idempotency → order flip). This
lets you exercise the full webhook flow end-to-end without a live PhonePe /
Paytm account.

| Method | Route | Body |
| --- | --- | --- |
| `POST` | `/api/v1/payments/dev/phonepe/simulate` | `{ orderId, outcome: "paid"|"failed", merchantOrderId? }` |
| `POST` | `/api/v1/payments/dev/paytm/simulate` | `{ orderId, outcome: "paid"|"failed" }` |

> **These routes are dev-only** — they are hard-gated by `requireDev()` and
> will return an error in production. Use them only against a local or staging
> deployment. Calling either simulate route twice with the same transaction ID
> demonstrates webhook idempotency.

---

## 5. Webhook Configuration

For automatic payment verification to work, each provider must be told where to
send callbacks. Configure the following webhook URLs in the provider's
dashboard (look for the "Webhook", "Callback URL", or "Notification URL" field
in the API integration section of the provider dashboard).

### 5.1 Webhook URLs

| Provider | URL |
| --- | --- |
| PhonePe | `https://your-domain.com/api/v1/payments/phonepe/webhook` |
| Paytm | `https://your-domain.com/api/v1/payments/paytm/callback` |

Replace `https://your-domain.com` with your actual PrintShop deployment origin
(`APP_BASE_URL`, see §9). The path portion is fixed by PrintShop's route
definitions and cannot be customized.

### 5.2 HTTP method + content type

| Provider | Method | Request format | Expected response |
| --- | --- | --- | --- |
| PhonePe | `POST` | Raw text body (base64-encoded JSON in the `body` field) | `200 OK` with body `OK` and `Content-Type: text/plain` |
| Paytm | `POST` | `application/x-www-form-urlencoded` (form fields incl. `CHECKSUMHASH`) | `200 OK` with an HTML success/failure page, `Content-Type: text/html; charset=utf-8` |

PrintShop's webhook routes (`src/app/api/v1/payments/phonepe/webhook/route.ts`
and `src/app/api/v1/payments/paytm/callback/route.ts`) read the raw body and
headers and pass them to `processWebhook`, which delegates signature
verification to the matching adapter.

### 5.3 Signature verification

| Provider | Header / field | Algorithm | Verified by |
| --- | --- | --- | --- |
| PhonePe | `X-VERIFY` header | `sha256(base64(rawBody) + saltKey) + "###" + saltIndex` | UPIPay SDK `verifyWebhook` (v1); for v2 (no saltKey) the decoded payload is accepted + the v2 status API is checked as authoritative |
| Paytm | `CHECKSUMHASH` form field | `AES-128-CBC(sha256(sortedParams|merchantKey))` with constant-time compare | `PaytmPaymentAdapter.handleWebhook` |

If verification fails, the webhook returns `401` and the order is **not** flipped
— protecting against forged callbacks. PrintShop additionally calls the
provider's status API after a successful webhook as a second layer of
defense-in-depth (catches both forgeries *and* replay races).

---

## 6. Credential Encryption

### 6.1 Algorithm + format

Shop credentials are encrypted at rest with **AES-256-GCM** using a 12-byte
nonce and a 16-byte auth tag (see `src/lib/crypto/credential-encryption.ts`).
The on-disk ciphertext format is:

```
v1:<nonceHex>:<ciphertextHex>:<tagHex>
```

- `v1` — key-version prefix (enables future key rotation).
- `nonceHex` — 12-byte random nonce, hex-encoded.
- `ciphertextHex` — the encrypted JSON blob, hex-encoded.
- `tagHex` — the GCM auth tag, hex-encoded (tamper-detection).

The plaintext payload is the JSON-serialized `paymentCredentials` object
(e.g. `{ "phonepe": {…}, "paytm": {…} }`).

### 6.2 The `PAYMENT_ENCRYPTION_KEY` env var

The encryption key is read from `PAYMENT_ENCRYPTION_KEY`, which must be **32
bytes base64-encoded**. Generate it with:

```bash
openssl rand 32 | base64
```

Store the result in your environment / secret manager. In production, prefer a
managed secret store (AWS KMS, Doppler, Infisical, Vercel project env vars,
etc.) — never commit it to source.

### 6.3 Startup validation

`getEncryptionKey()` enforces:

- In `NODE_ENV=production`, the absence of `PAYMENT_ENCRYPTION_KEY` is
  **fatal** — the server throws on first use of the encryption module.
- The decoded key must be exactly **32 bytes**; otherwise an error is thrown
  regardless of environment.
- In non-production with the env var unset, a deterministic all-`0x41`
  placeholder key is used so local dev "just works" — but **never** rely on
  this in any deployment.

### 6.4 Credentials are NEVER returned to the frontend

The `GET /api/v1/shops/me/payment-credentials` endpoint returns only
**masked** values via `buildStatus()`:

- Secret values (PhonePe `saltKey` / `clientSecret`, Paytm `merchantKey`) →
  never returned at all.
- Non-secret identifiers (`merchantId`, `clientId`) → masked as
  `first4…last4` (e.g. `M23I…0433`).
- The response includes per-provider `connected`, `authVersion`, `env`, and
  the webhook URL paths (which are not secrets) — nothing else.

This means a compromised session token cannot exfiltrate live credentials.

---

## 7. Credential Rotation

### 7.1 Updating credentials

To rotate credentials (e.g. after a PhonePe salt key refresh or Paytm key
rotation):

1. Open the payment settings panel and select the provider.
2. Paste the new credential values (use the same `env` unless you're also
   flipping sandbox → prod).
3. Click **Save**.

Internally, `PUT /api/v1/shops/me/payment-credentials`:

- Validates the body with a per-provider / per-auth-version Zod schema.
- Merges the new provider credentials into the existing `paymentCredentials`
  blob — **the other provider's credentials are preserved** (not overwritten).
- Re-encrypts the whole blob with the current `PAYMENT_ENCRYPTION_KEY` and
  persists it.
- Writes an audit log entry (see §7.3).
- Returns the new masked status.

### 7.2 Disconnecting a provider

Call `DELETE /api/v1/shops/me/payment-credentials?provider=phonepe` (or
`?provider=paytm`). This:

- Removes that provider's entry from `paymentCredentials` (the other
  provider's entry, if any, is preserved).
- If the disconnected provider was the active one, automatically switches
  `paymentProvider` to `googlepay` — i.e. the UPI deep-link / QR fallback —
  so the shop can keep accepting payments via manual verification.
- Writes an audit log entry.

### 7.3 Audit trail

Every credential action is logged via `repos.audit.log`:

| Action | Logged metadata |
| --- | --- |
| `payment.credentials.saved` | `provider`, `authVersion`, `env`, redacted `fields` list (secrets excluded) |
| `payment.credentials.disconnected` | `provider`, `wasActive` (boolean) |

The audit log records **field names only** (e.g. `["merchantId","env"]`) —
never the actual credential values. Every entry is scoped to the
authenticated user's shop (`principal.shopId`), so cross-tenant access is
impossible.

---

## 8. QR-only vs Automatic Verification

PrintShop supports two fundamentally different payment modes:

### 8.1 UPI deep-link / QR (manual verification)

- **Provider key:** `googlepay` (the UPI deep-link / QR fallback).
- **Credentials needed:** none — just the shopkeeper's personal or merchant
  UPI ID.
- **Flow:** the customer sees a UPI deep-link / QR, pays via their UPI app
  (GPay, PhonePe UPI, Paytm UPI, BHIM, etc.), and the **shopkeeper manually
  marks the order paid** in the PrintShop dashboard after confirming receipt
  in their UPI app.
- **No automatic verification.** This is the only mode available without a
  registered merchant account.

### 8.2 API-enabled merchant payments (automatic verification)

- **Provider keys:** `phonepe`, `paytm`.
- **Credentials needed:** PhonePe or Paytm merchant credentials (§2, §3).
- **Flow:** the customer is redirected to the provider's hosted payment page;
  on completion the provider sends a webhook, PrintShop verifies the signature
  + amount, and the order is automatically flipped to `paid`.
- The shopkeeper does nothing — verification is automatic and auditable.

### 8.3 Important caveat

> **An ordinary personal UPI ID does NOT support automatic verification.** UPI
> itself has no "webhook" — only registered **merchant** accounts on PhonePe
> or Paytm (with API credentials) emit callbacks. If a shopkeeper wants
> automatic verification, they must register with PhonePe Business or Paytm
> Business and configure API credentials as described in §2 and §3.

When a shop disconnects its merchant provider (or never configured one),
PrintShop automatically falls back to `googlepay` (QR / UPI deep-link), so the
shop can keep accepting payments — just without automatic verification.

---

## 9. Required Environment Variables

Only **two** environment variables matter for payment functionality in
production:

| Variable | Required? | Purpose |
| --- | --- | --- |
| `PAYMENT_ENCRYPTION_KEY` | **Required in production** | 32-byte base64 key for AES-256-GCM encryption of shop credentials. Generate with `openssl rand 32 \| base64`. Server fails to start (on first encryption use) if missing in prod. |
| `APP_BASE_URL` | Required for webhooks | The public origin of your PrintShop deployment (e.g. `https://shop.example.com`). Used by the adapters to construct webhook/callback URLs sent to PhonePe / Paytm at payment-create time. Defaults to `http://localhost:3000` if unset (dev only). |

### 9.1 Provider-specific env vars

`.env.example` lists optional provider env vars (`PHONEPE_SALT_KEY`,
`PHONEPE_CLIENT_ID`, `PAYTM_MERCHANT_ID`, `PAYTM_MERCHANT_KEY`, etc.). These
are **seeder + dev-simulate-route only** — they are **not** read by the
production payment adapters. The adapters read each shop's credentials from
the (encrypted) database via the per-shop `paymentCredentials` blob.

**Do not rely on env vars to configure per-shop provider credentials in
production.** Every shop configures its own credentials through the
`/api/v1/shops/me/payment-credentials` API (§7).

---

## 10. Troubleshooting

### "Connection test failed"

- Double-check each credential value character-by-character — extra whitespace
  is the most common culprit.
- Verify the `env` field matches your actual credential set: a sandbox
  `saltKey` paired with `env=prod` will fail, and vice versa.
- For PhonePe v2, confirm `clientId`, `clientSecret`, **and** `clientVersion`
  are all set (v2 mode triggers only when both `clientId` and `clientSecret`
  are present).
- For Paytm, confirm `website` is `WEBSTAGING` in sandbox and `DEFAULT` in
  production.

### "Webhook not received"

- Confirm the webhook URL is registered in the provider's dashboard (§5.1).
- Confirm `APP_BASE_URL` is set to your **publicly reachable** origin —
  PhonePe/Paytm cannot reach `http://localhost:3000`.
- Confirm your deployment accepts `POST` requests on the webhook path (no
  WAF rule blocking form-encoded / raw-text bodies).
- For local testing, use a tunnel (ngrok, Cloudflare TryCloudflare) and
  register that URL in the provider's **sandbox** dashboard.

### "Payment not verified"

- Check the webhook signature verification logs — a `401` from the webhook
  route indicates signature mismatch (wrong `saltKey`/`merchantKey`, or a
  PhonePe v2 callback being checked against a missing `saltKey`).
- Confirm the **amount** in the webhook matches the order amount — PrintShop
  enforces amount integrity and rejects mismatches.
- For PhonePe v2, the webhook payload is decoded directly (no X-VERIFY with
  `saltKey`); the authoritative check is the v2 status API. If the status API
  call fails, check `clientId` / `clientSecret` / `clientVersion`.
- Use the dev simulate routes (§4.3) to reproduce the issue locally with
  deterministic payloads.

### "OAuth2 token failed" (PhonePe v2)

- Confirm `clientId` and `clientSecret` are correct and not expired.
- Confirm `clientVersion` matches the value PhonePe assigned when issuing your
  OAuth2 credentials (typically `1`, but verify in your PhonePe Business
  dashboard).
- Confirm `env` is set correctly — the OAuth2 token endpoint differs between
  sandbox (`https://api-preprod.phonepe.com/apis/hermes/oauth/v1/token`) and
  production (`https://api.phonepe.com/apis/hermes/oauth/v1/token`).
- The token is cached in-process for ~10 minutes; if you've just rotated
  credentials you may need to redeploy or wait for the cache to expire before
  the new credentials take effect on existing instances.
