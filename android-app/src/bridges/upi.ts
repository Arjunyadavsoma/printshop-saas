/**
 * UPI payment bridge — launches the installed UPI app via Android Intent.
 *
 * The web checkout returns `{ upiUri: "upi://pay?pa=...&am=...&tn=..." }`.
 * In a browser, this opens via `window.location = upiUri` — which may fail
 * silently if no UPI app is registered, or show a "open with..." dialog
 * that's confusing for non-technical users.
 *
 * In the companion app, this bridge fires a native Android Intent:
 *   Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(upiUri));
 *   startActivity(Intent.createChooser(intent, "Pay with"));
 *
 * The chooser shows ONLY installed UPI apps (PhonePe, GPay, Paytm, BHIM,
 * etc.) — Android filters by apps that register an intent filter for the
 * `upi://` scheme. This is the same UX as any native Indian payment app.
 *
 * IMPORTANT: this bridge does NOT confirm payment. The UPI app handles the
 * actual payment. The server resolves payment status via the PSP webhook
 * + the order-status poller (which the notifications bridge powers). This
 * bridge only launches the UPI app + reports whether the intent succeeded.
 */
import { registerPlugin } from '@capacitor/core';

/** The custom UPI plugin interface — implemented in Java in Task 5. */
export interface UPIIntentPlugin {
  pay(options: { upiUri: string }): Promise<{
    success: boolean;
    app?: string | null;
    error?: string;
  }>;
}

const UPIPlugin = registerPlugin<UPIIntentPlugin>('UPIIntent');

export async function payWithUPI(upiUri: string): Promise<{
  success: boolean;
  app?: string | null;
  error?: string;
}> {
  try {
    if (!upiUri || !upiUri.startsWith('upi://')) {
      return {
        success: false,
        app: null,
        error: 'Invalid UPI URI — must start with upi://',
      };
    }
    const result = await UPIPlugin.pay({ upiUri });
    return result;
  } catch (err) {
    return {
      success: false,
      app: null,
      error: err instanceof Error ? err.message : 'Failed to launch UPI app',
    };
  }
}
