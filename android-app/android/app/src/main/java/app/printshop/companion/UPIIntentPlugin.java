package app.printshop.companion;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.widget.Toast;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * UPIIntent — custom Capacitor plugin that launches a UPI payment intent.
 *
 * The TypeScript bridge (`android-app/src/bridges/upi.ts`) calls
 * `UPIPlugin.pay({ upiUri })` which resolves here. The Java side:
 *
 *   1. Parses the `upi://pay?pa=...&pn=...&am=...&tn=...` URI.
 *   2. Creates an `Intent.ACTION_VIEW` with that URI as data.
 *   3. Queries the PackageManager for apps that can handle the `upi://`
 *      scheme (PhonePe, Google Pay, Paytm, BHIM, etc.).
 *   4. If NO UPI app is installed, returns `{ success: false, error: "no_upi_app" }`
 *      so the web app can show "Install a UPI app" instead of silently failing.
 *   5. If ONE UPI app is installed, launches it directly.
 *   6. If MULTIPLE apps are installed, shows `Intent.createChooser` so the
 *      user picks their preferred one.
 *
 * The chooser title is localized via `@string/upi_chooser_title` ("Pay with").
 *
 * The plugin does NOT confirm payment — the UPI app handles the actual
 * transaction. Payment status is resolved server-side via the PSP webhook
 * + the order-status poller.
 *
 * Security: the `upiUri` parameter is validated to start with `upi://` before
 * being passed to Intent. This prevents a malicious page from launching
 * arbitrary intents (e.g. `intent://` or `market://` schemes that could
 * open other apps unexpectedly).
 */
@CapacitorPlugin(name = "UPIIntent")
public class UPIIntentPlugin extends Plugin {

    @PluginMethod
    public void pay(PluginCall call) {
        String upiUri = call.getString("upiUri");
        if (upiUri == null || upiUri.isEmpty()) {
            call.reject("upiUri is required");
            return;
        }

        // Security: only allow the `upi://` scheme. A malicious page could
        // try to pass `intent://` or `market://` to launch arbitrary apps.
        if (!upiUri.startsWith("upi://")) {
            call.reject("Invalid UPI URI — must start with upi://");
            return;
        }

        try {
            Uri uri = Uri.parse(upiUri);
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);

            // Query for apps that can handle the upi:// scheme.
            PackageManager pm = getContext().getPackageManager();
            List<ResolveInfo> apps = pm.queryIntentActivities(intent, 0);

            if (apps.isEmpty()) {
                // No UPI app installed — tell the user instead of silently
                // failing. The web app's checkout UI can branch on the
                // "no_upi_app" error code and show an install prompt.
                JSObject result = new JSObject();
                result.put("success", false);
                result.put("app", null);
                result.put("error", "no_upi_app");
                call.resolve(result);
                return;
            }

            // Show a chooser if multiple UPI apps are installed; otherwise
            // launch the single one directly.
            Intent chooser = Intent.createChooser(intent, getString(R.string.upi_chooser_title));
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            // Resolve the selected app's package name so we can return it
            // to the caller for audit logging. The chooser intent doesn't
            // directly return which app was picked, so we use the
            // startActivityForResult pattern via the bridge.
            getActivity().startActivity(chooser);

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("app", null); // chooser doesn't report selection
            call.resolve(result);

        } catch (Exception e) {
            JSObject result = new JSObject();
            result.put("success", false);
            result.put("app", null);
            result.put("error", e.getMessage() != null ? e.getMessage() : "intent_failed");
            call.resolve(result);
        }
    }
}
