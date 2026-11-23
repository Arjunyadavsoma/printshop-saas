# UPI Manual Tests — PrintShop Customer Redesign (P8.1)

This document is the **manual test script** for UPI deep-link payment on the
PrintShop customer surface (`/s/{shopSlug}` → Pay with UPI). It exists
because UPI intent handling differs across PSPs, OS versions, and browsers;
the unit tests in `src/lib/customer/upi-link.test.ts` only verify the URI
string, not whether the OS actually launches the right app and pre-fills the
amount.

The matrix below must be executed by a human tester on real devices before
every release that touches the UPI link builder, the PaymentSheet, or the
customer order-flow pay step. **Record actual results in the empty columns
on the right; do not pre-fill them.**

> **Tester**: ____________________   **Date**: ____________________  
> **Build / commit**: ____________________  
> **Tester device notes** (Android version, iOS version, app versions): 
> ____________________________________________________________

---

## 1. Test matrix

| # | App | VPA type | Browser | Pre-fills amount? | Accepts payment? | Notes (record actual results here) |
|---|-----|----------|---------|-------------------|------------------|------------------------------------|
| 1 | Google Pay | Merchant (e.g. `quickprint@okaxis`) | Android Chrome | ☐ yes ☐ no | ☐ yes ☐ no | |
| 2 | Google Pay | Merchant | iOS Safari | ☐ yes ☐ no | ☐ yes ☐ no | |
| 3 | Google Pay | Personal (e.g. `ravi@okhdfcbank`) | Android Chrome | ☐ yes ☐ no | ☐ yes ☐ no | |
| 4 | Google Pay | Personal | iOS Safari | ☐ yes ☐ no | ☐ yes ☐ no | |
| 5 | PhonePe | Merchant | Android Chrome | ☐ yes ☐ no | ☐ yes ☐ no | |
| 6 | PhonePe | Merchant | iOS Safari | ☐ yes ☐ no | ☐ yes ☐ no | |
| 7 | PhonePe | Personal | Android Chrome | ☐ yes ☐ no | ☐ yes ☐ no | |
| 8 | PhonePe | Personal | iOS Safari | ☐ yes ☐ no | ☐ yes ☐ no | |
| 9 | Paytm | Merchant | Android Chrome | ☐ yes ☐ no | ☐ yes ☐ no | |
| 10 | Paytm | Merchant | iOS Safari | ☐ yes ☐ no | ☐ yes ☐ no | |
| 11 | Paytm | Personal | Android Chrome | ☐ yes ☐ no | ☐ yes ☐ no | |
| 12 | Paytm | Personal | iOS Safari | ☐ yes ☐ no | ☐ yes ☐ no | |

**Total**: 12 combinations × 2 outcomes = **24 binary checks**. A release is
**blocked** if any check fails on a browser the shop's customers actually
use (sample the shop's analytics for the top 2 browsers before testing).

---

## 2. Expected results (per combination)

For each row in the matrix above, this is what we expect to happen when the
tester taps the app button in the PrintShop PaymentSheet:

| # | App | VPA type | Browser | Expected: pre-fills amount? | Expected: accepts payment? | Notes |
|---|-----|----------|---------|------------------------------|------------------------------|-------|
| 1 | Google Pay | Merchant | Android Chrome | **Yes** — GPay respects the `am` param from `upi://pay?…` | **Yes** — payment succeeds; UTR is generated | Merchant VPA may show a "verified merchant" badge. |
| 2 | Google Pay | Merchant | iOS Safari | **Yes** (iOS 14.5+ supports `upi://` via the default UPI app picker; GPay is a UPI intent handler) | **Yes** | iOS may show a "Open in Google Pay?" confirmation dialog before launching. |
| 3 | Google Pay | Personal | Android Chrome | **Yes** | **Yes** | Personal VPA — no merchant badge. |
| 4 | Google Pay | Personal | iOS Safari | **Yes** | **Yes** | Same as #2 but no merchant badge. |
| 5 | PhonePe | Merchant | Android Chrome | **Yes** | **Yes** | PhonePe may show its own merchant verification UI. |
| 6 | PhonePe | Merchant | iOS Safari | **Yes** | **Yes** | iOS PhonePe has historically had a slightly different intent handler than Android; verify the `tr` (transaction reference) is preserved. |
| 7 | PhonePe | Personal | Android Chrome | **Yes** | **Yes** | |
| 8 | PhonePe | Personal | iOS Safari | **Yes** | **Yes** | |
| 9 | Paytm | Merchant | Android Chrome | **Yes** | **Yes** | Paytm may pre-fill its own merchant name from the VPA lookup, overriding `pn`. |
| 10 | Paytm | Merchant | iOS Safari | **Yes** | **Yes** | |
| 11 | Paytm | Personal | Android Chrome | **Yes** | **Yes** | |
| 12 | Paytm | Personal | iOS Safari | **Yes** | **Yes** | |

### 2.1 Common failure modes to watch for

- **Amount NOT pre-filled**: the UPI app launches but the amount field is
  empty or shows `0.00`. This usually means the `am` parameter is missing
  or malformed in the URI. Check the URI in the browser's dev-tools
  `console.log(upiUri)` before launching.
- **Wrong payee name**: the UPI app shows a different name than `pn`. Some
  PSPs override `pn` with the VPA's registered name (the bank's record).
  This is expected behaviour — the customer pays the right VPA regardless.
- **App does not launch at all**: the OS shows "No app found to handle this
  link" or silently does nothing. This means the `upi://` scheme is not
  registered (the user has no UPI app installed) OR the browser blocked
  the intent (iOS Safari sometimes blocks `upi://` launches from
  non-user-gesture contexts).
- **Payment fails after launch**: the UPI app launches and pre-fills, but
  the payment itself is rejected (insufficient balance, UPI pin wrong,
  daily limit hit). This is **not** a PrintShop bug — note it in the
  "Notes" column and retest with a different account.

---

## 3. App-specific deep-link schemes

The PrintShop customer flow ships **one** UPI launch button per app in the
PaymentSheet, and every button uses the generic `upi://pay?…` URI. We do NOT
ship app-specific schemes (`tez://`, `phonepe://`, `paytmmp://`, `bhim://`)
as separate buttons because none of the four major PSPs publishes a plain
deep-link contract for web/QR use.

The research findings are documented in `src/lib/customer/upi-link.ts` (see
`UPI_APP_SCHEMES`). Each entry carries a `source` URL so a future maintainer
can re-verify. The full registry:

| App | Scheme | Verified? | Source | Notes |
|-----|--------|-----------|--------|-------|
| Google Pay | `tez://` / `gpay://` | **No** | https://developers.google.com/pay/api/web | Google Pay respects the generic `upi://` link via the OS UPI intent picker. The `tez://` and `gpay://` schemes exist in legacy APK manifests but are NOT officially documented for web/QR use. |
| PhonePe | `phonepe://` | **No** | https://developer.phonepe.com/v1/docs/build-pg-integration-sdk/ | PhonePe publishes `phonepe://` for merchant SDK integrations (signed transaction request), NOT as a plain deep-link. Generic `upi://` works. |
| Paytm | `paytmmp://` | **No** | https://developer.paytm.com/docs/ | `paytmmp://` is documented for Paytm merchant SDK in-app flows, not web/QR. Generic `upi://` works for Paytm UPI. |
| BHIM | `bhim://` | **No** | https://www.npci.org.in/what-we-do/upi/bhim | `bhim://` is referenced in NPCI documentation but is not consistently registered across BHIM app versions. Generic `upi://` is the reliable path. |
| Other UPI apps | `upi://` | **Yes** | https://www.npci.org.in/PDF/npci/upi/procedure-linking-specification.pdf | The generic `upi://pay?…` scheme is the NPCI-standard deep link. It always works — the OS routes it to the user-chosen UPI app via the intent picker. |

**Policy**: if a future maintainer flips a scheme's `verified` flag to
`true`, they MUST have a working source URL and a passing row in the matrix
above for that scheme on both Android Chrome and iOS Safari. Code review
should reject any change to `verified: true` without a corresponding
successful manual test row.

---

## 4. Pre-test setup

Before running the matrix:

1. **Test VPAs**: have a known merchant VPA (e.g. `quickprint@okaxis` if
   the shop's PSP supports merchant VPAs, or `quickprint@ybl` for PhonePe
   merchant) and a known personal VPA (e.g. `ravi@okhdfcbank`) available.
   Both must be active and able to receive payments.
2. **Test amount**: use ₹1.00 (100 paise) for the test payment. Small enough
   to not hurt the tester's wallet, large enough that the UPI app shows a
   non-zero amount.
3. **Test order**: create a real customer order in the PrintShop app
   (`/s/{shopSlug}` → upload a small PDF → select B&W 1 page → place order).
   Note the order token (e.g. `ABC123`).
4. **Test devices**: have an Android phone (Chrome) and an iOS phone
   (Safari) with the three UPI apps installed. Sign into each UPI app
   with a test account.
5. **Network**: connect both devices to a stable network (the UPI launch
   itself does not need the internet, but the payment confirmation does).

---

## 5. Test procedure (per row in the matrix)

For each of the 12 combinations:

1. Open the customer order page (`/o/{token}`) on the test device's
   browser.
2. Tap **Pay with UPI**.
3. In the PaymentSheet, tap the row for the app under test.
4. Observe whether the UPI app launches.
5. Observe whether the **amount is pre-filled** with ₹1.00.
6. Observe whether the **payee name** matches `pn` from the URI.
7. Observe whether the **transaction note** (`tn`) is shown.
8. Complete the payment (enter UPI pin).
9. Observe whether the payment succeeds (UTR is generated).
10. Return to PrintShop → confirm the order status updates to "Paid"
    (the shopkeeper verifies manually — the UPI launch itself does NOT
    confirm the payment on the PrintShop side).
11. Record the two binary outcomes (pre-fills amount? accepts payment?)
    and any notes in the matrix.

---

## 6. Edge cases (run AFTER the matrix is clean)

These are NOT in the 12-row matrix but should be checked at least once per
release:

| # | Edge case | Expected behaviour | Actual |
|---|-----------|--------------------|--------|
| E1 | Shop name with spaces (`Quick Print Services`) | URI encodes spaces as `+` or `%20`; UPI app shows the full name with spaces. | |
| E2 | Shop name with Hindi (`श्री गणेश प्रिंट स्टोर`) | URI percent-encodes UTF-8; UPI app shows the Devanagari characters. | |
| E3 | Shop name with Telugu (`శ్రీ గణేష్ ప్రింట్ స్టోర్`) | URI percent-encodes UTF-8; UPI app shows the Telugu characters. | |
| E4 | Shop name with ampersand (`Shop & Sons`) | URI encodes `&` as `%26`; the UPI app shows `Shop & Sons` (NOT `Shop ` with `Sons` truncated as a new URI param). | |
| E5 | Amount = 0 paise (`₹0.00`) | URI shows `am=0.00`; UPI app pre-fills `0.00`. Used for "pay what you want" / token orders. The UPI app should still launch (some PSPs reject zero-rupee payments — note which). | |
| E6 | Amount = 5 paise (`₹0.05`) | URI shows `am=0.05`; UPI app pre-fills `0.05`. | |
| E7 | Amount = ₹1000.00 (100000 paise) | URI shows `am=1000.00`; UPI app pre-fills `1000.00`. | |
| E8 | No UPI app installed | The OS shows "No app found to handle `upi://`" or silently fails. PrintShop's "Copy UPI ID" row is the manual fallback. | |
| E9 | User dismisses the UPI app without paying | PrintShop order stays in `PENDING_PAYMENT`; the shopkeeper never marks it paid. No spurious state change. | |
| E10 | Network drops DURING the UPI app launch | The intent already fired; the UPI app completes the payment offline (UPI works without internet on the device — the PSP reconciles later). PrintShop's offline banner shows. | |
| E11 | User taps the app button twice rapidly | Only one UPI intent launches (the OS debounces). No double-payment risk. | |
| E12 | The `tn` (note) contains an ampersand | URI encodes `&` as `%26` in `tn`; the UPI app shows the full note. (Critical: a raw `&` in `tn` would split into a new URI param.) | |

---

## 7. Sign-off

A release may proceed only when:

- [ ] All 12 rows in the matrix (Section 1) have both outcomes recorded
      as **Yes** (or marked N/A with a justification in Notes).
- [ ] All edge cases in Section 6 have actual results recorded.
- [ ] Any failure has a linked bug ticket with the URI, the device, the
      app version, and a screen recording.
- [ ] The app-specific scheme registry in `src/lib/customer/upi-link.ts`
      has been re-verified against the `source` URLs (a maintainer has
      clicked every `source` link within the last 90 days).

**Tester sign-off**: ____________________  
**Reviewer sign-off**: ____________________  
**Release version**: ____________________  
**Date**: ____________________

---

## 8. References

- NPCI BHIM UPI Deep Linking Specification (PDF):
  https://www.npci.org.in/PDF/npci/upi/procedure-linking-specification.pdf
- NPCI UPI documentation: https://www.npci.org.in/what-we-do/upi
- Google Pay for web (no `tez://` / `gpay://` deep-link contract for web/QR):
  https://developers.google.com/pay/api/web
- PhonePe developer docs (merchant SDK only):
  https://developer.phonepe.com/v1/docs/build-pg-integration-sdk/
- Paytm developer docs (merchant SDK only):
  https://developer.paytm.com/docs/
- BHIM NPCI page (no `bhim://` deep-link contract published):
  https://www.npci.org.in/what-we-do/upi/bhim
- PrintShop unit tests for the URI builder:
  `src/lib/customer/upi-link.test.ts`
- PrintShop source for the URI builder + scheme registry:
  `src/lib/customer/upi-link.ts`
