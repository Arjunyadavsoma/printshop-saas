# Task: build-payment-ui

**Agent**: frontend-developer
**Date**: 2026-11-04
**Scope**: Add a Payment Provider Management section to the top of the `payment` tab on `/shop/settings`.

## Files changed

- **NEW** `src/components/portal/payment-provider-settings.tsx` — self-contained client component (≈730 lines, fully typed).
- **EDIT** `src/app/shop/settings/page.tsx`:
  - Added `import { PaymentProviderSettings } from '@/components/portal/payment-provider-settings';` (after the `@platform/core/domain` import, L55).
  - Rendered `<PaymentProviderSettings />` at the very top of the `<TabsContent value="payment">` block, BEFORE the existing UPI fields Card (L893–895).

## API contract consumed

All routes live at `/api/v1/shops/me/payment-credentials/*` and were already implemented by the prior backend task:

| Method | Route | Used for |
|---|---|---|
| GET | `/` | Load masked provider status on mount + after each mutation |
| PUT | `/` | Save (with optional activate in sequence) |
| POST | `/test` | Test connection (uses SAVED creds → must Save before Test) |
| POST | `/activate` | Activate a connected provider |
| DELETE | `/?provider=X` | Disconnect + auto-fallback to `googlepay` if it was active |

Response shape (`ApiEnvelope<PaymentStatus>` where `success/data/error` come from `lib/api/envelope.ok/fail`):
```ts
{
  success: true,
  data: {
    activeProvider: string,                   // 'phonepe' | 'paytm' | 'googlepay' | …
    providers: {
      phonepe?: { connected, authVersion?, env?, merchantId?, clientId?, saltKey? },
      paytm?:   { connected, authVersion?, env?, merchantId?, website? },
    },
    webhookUrls: { phonepe: '/api/v1/payments/phonepe/webhook', paytm: '/api/v1/payments/paytm/callback' },
  }
}
```

## UX flow

1. **On mount**: `GET` → masked status. Skeleton cards shown while loading; amber-bordered retry card on error.
2. **Two provider cards** (PhonePe Business + Paytm Business):
   - Badges: `Active` (amber), `Connected` / `Not connected`, auth-version (`v2 · OAuth2` / `v1 · Standard` / `Standard`), env (`Sandbox` / `Production` — production badge tinted rose).
   - Masked identifiers (e.g. `M23I...0433`) shown under the description when connected.
   - Buttons: `Activate` (when connected but not active), `Connect` / `Manage` (toggles the form panel), `Disconnect` (ghost, rose).
3. **PhonePe form panel**: a `<Select>` for auth version (`v2` / `v1`). Auto-picks `v1` if the saved creds are v1.
   - v2 fields: Client ID, Client Secret, Client Version, Merchant ID, Environment — secret toggle on the first three.
   - v1 fields: Merchant ID, Salt Key, Salt Index, Environment.
4. **Paytm form panel**: Merchant ID, Merchant Key, Website, Environment. Website auto-suggests `WEBSTAGING`/`DEFAULT` when env changes (preserves user-customized values).
5. **Form actions**: `Test connection` (disabled until saved), `Save`, `Save & Activate` (amber primary). All three show `Loader2` spinners while busy.
6. **Test result banner**: green (`Connection OK · Latency Xms`) or rose (`Connection failed …`) inline banner + sonner toast.
7. **Disconnect**: opens an `AlertDialog` confirming; if the provider was active, the warning explains the fallback to manual UPI.
8. **Webhook configuration card**: shows the absolute URL (`window.location.origin` + relative path from API) for PhonePe + Paytm, each with a `Copy URL` button → `navigator.clipboard.writeText` + sonner toast.
9. **Security notice card** (amber-tinted): AES-256-GCM encryption blurb, the "PrintShop will never ask for UPI PIN/OTP/bank password/payment-app password" warning, and a note that secret fields are never pre-filled.
10. **Onboarding guides** (native `<details>`/`<summary>`): step-by-step instructions for PhonePe Business and Paytm Business dashboards, with external links (rel=noopener noreferrer).

## Design / code-quality decisions

- **Self-contained**: zero shared state with the parent settings page. Fetches its own status on mount. Doesn't touch the parent's `setShop()` — the parent already re-loads shop info on its own when needed.
- **Secret fields are never pre-filled**. Each form draft starts empty (`emptyV2`, `emptyV1`, `emptyPaytm`). The placeholder text is `••••••••••••` and a security-notice bullet explicitly tells the user "to update, re-enter all fields". This mirrors the API which requires all fields on PUT (Zod `.min(1)`).
- **amber-600 accent**: used for the primary "Save & Activate" button, the `Active` badge, the section card titles' icons, the security card border, and the onboarding-guide summary text — matching the rest of the app (settings page uses `bg-amber-600` throughout).
- **Touch-friendly**: input height `h-11 sm:h-9`, button min-height ≥ 36px, 44px tap targets preserved.
- **Mobile-responsive**: `grid sm:grid-cols-2` for forms, `flex-col sm:flex-row` for the provider card header / actions.
- **Sonner toasts** for every success/failure — `<Toaster />` already mounted in `src/app/layout.tsx` (L122).
- **API client**: uses the shared `useApiClient()` hook from `@/components/portal/use-api-client` (which re-exports from `auth-context.tsx`). Benefits from auto 401-refresh.
- **No new deps** — only uses existing shadcn/ui components + lucide-react icons.

## Verifications

- `bunx tsc --noEmit` → **0 errors**.
- `bun run lint` → **0 warnings** (exit 0).
- `bunx vitest run` → **218/218 pass** (21 test files).
- Dev server log (`dev.log`) shows healthy `GET / 200` responses; no compile errors.

## What this enables for the user (shopkeeper)

Before this change, the `payment` tab only had manual UPI fields (UPI ID, payment phone, payment instructions, cash-on-pickup). Now the shopkeeper can:
- Connect PhonePe Business (v1 or v2) or Paytm Business directly from the settings page.
- Test the connection without leaving the page.
- Activate one provider at a time (replaces the manual UPI flow for new checkouts).
- See masked identifiers confirming which credentials are saved.
- Copy webhook URLs for pasting into the PSP dashboard.
- Read onboarding instructions inline (no need to leave the app).
- Disconnect with a clear confirmation dialog.

This unlocks automatic online payment acceptance for PrintShop shops, replacing the current manual "send screenshot to WhatsApp" verification loop.
