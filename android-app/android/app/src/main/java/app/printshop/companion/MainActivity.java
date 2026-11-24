package app.printshop.companion;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.BridgeActivity;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/**
 * Main entry activity for the PrintShop Companion app.
 *
 * Extends Capacitor's BridgeActivity, which creates the WebView that loads
 * the deployed Next.js consumer app (capacitor.config.ts → server.url) and
 * registers the Capacitor plugins. The custom UPIIntentPlugin is registered
 * in onCreate so the TypeScript `upi.ts` bridge can call
 * `UPIPlugin.pay({ upiUri })`.
 *
 * Two long-missing pieces live here now:
 *
 * 1. NATIVE BRIDGE INJECTION — `native-bridges.js` (built by
 *    `scripts/inject-bridges.js` from src/, synced into assets/public/ by
 *    `cap sync`) is evaluated at the start of every page load. Without this
 *    the bundle was dead code: the app loads a REMOTE URL, so nothing in the
 *    page ever referenced the asset and `window.NativeApp` stayed undefined.
 *    Injected on `onPageStarted` (runs before the page's own scripts in
 *    practice) with an `onPageFinished` safety net guarded by a
 *    `window.NativeApp` existence check so it never double-attaches.
 *
 * 2. DEEP-LINK ROUTING — `printshop://shop/<slug>` and https App-Links to
 *    the production domain now navigate the WebView to that shop page.
 *    Previously the links only opened the app, which sat on the home page.
 */
public class MainActivity extends BridgeActivity {

    /** Production storefront — keep in sync with capacitor.config.ts. */
    private static final String STOREFRONT_URL = "https://printelyx.cc.cd";
    /** App host used by the App-Link intent filter (also the manifest). */
    private static final String APP_HOST = "printelyx.cc.cd";

    private String bridgeJs;
    private boolean bridgesInjected = false;

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Register the custom UPI Intent plugin. The string "UPIIntent"
        // MUST match the plugin name in `upi.ts`'s `registerPlugin('UPIIntent')`.
        registerPlugin(UPIIntentPlugin.class);
        // AppSettings — the web permission flows call
        // NativeApp.permissions.openSettings() to recover from permanent
        // permission denials (Android ignores re-prompts after "don't ask again").
        registerPlugin(AppSettingsPlugin.class);

        // WebView tuning (speed + geolocation):
        //  - geolocationEnabled lets the WebView-side navigator.geolocation
        //    work as a fallback; the primary path is the native Geolocation
        //    plugin bridge (deterministic prompt, OEM-independent).
        //  - LOAD_DEFAULT keeps normal HTTP caching — repeat visits render
        //    from cache while revalidating, the fastest safe mode.
        if (bridge != null && bridge.getWebView() != null) {
            android.webkit.WebSettings ws = bridge.getWebView().getSettings();
            ws.setGeolocationEnabled(true);
            ws.setCacheMode(android.webkit.WebSettings.LOAD_DEFAULT);
        }

        bridgeJs = readAsset("public/native-bridges.js");
        installWebViewClient();
        navigateFromIntent(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        navigateFromIntent(intent);
    }

    /** Read a text asset (paths are relative to assets/, where `cap sync`
     *  puts the web bundle under public/). */
    private String readAsset(String path) {
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(getAssets().open(path), StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append('\n');
            }
            return sb.toString();
        } catch (Exception e) {
            android.util.Log.w("Companion", "native-bridges.js not found in assets — run `npm run sync`", e);
            return null;
        }
    }

    /** Inject the bridge bundle + route deep links inside the WebView. */
    @SuppressLint("SetJavaScriptEnabled")
    private void installWebViewClient() {
        WebView webView = bridge != null ? bridge.getWebView() : null;
        if (webView == null) return;

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                bridgesInjected = false;
                injectBridges(view);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // Safety net: if the onPageStarted injection raced the page's
                // scripts (large bundle, slow device), run it again here —
                // guarded so window.NativeApp is never double-defined.
                injectBridges(view);
            }
        });
    }

    private void injectBridges(WebView view) {
        if (bridgesInjected || bridgeJs == null) return;
        // The bundle is wrapped in an IIFE that only attaches window.NativeApp
        // when absent; the guard here avoids re-running the whole bundle.
        view.evaluateJavascript(
            "if(typeof window.NativeApp==='undefined'){" + bridgeJs + "}",
            result -> bridgesInjected = true);
        bridgesInjected = true;
    }

    /** Map an incoming deep link to a storefront URL and load it.
     *  Supported: printshop://shop/<slug> and https://<our hosts>/… */
    private void navigateFromIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        Uri data = intent.getData();
        String target = null;

        if ("printshop".equals(data.getScheme()) && "shop".equals(data.getHost())) {
            String slug = data.getPathSegments() != null && data.getPathSegments().size() > 0
                ? data.getPathSegments().get(0) : null;
            if (slug != null && !slug.isEmpty()) {
                target = STOREFRONT_URL + "/s/" + slug;
            }
        } else if ("https".equals(data.getScheme())
                && (APP_HOST.equals(data.getHost())
                    || "printshop-saas-arjunyadav35763-gmailcoms-projects.vercel.app".equals(data.getHost()))) {
            target = data.toString();
        }

        if (target == null) return;
        // Lambdas below capture this — must be effectively final (target is
        // reassigned while resolving, so copy it).
        final String targetUrl = target;
        WebView webView = bridge != null ? bridge.getWebView() : null;
        if (webView == null) {
            // Bridge not ready yet (cold start) — retry once the app resumes.
            runOnUiThread(() -> webViewPost(targetUrl));
            return;
        }
        String current = webView.getUrl();
        if (current == null || !current.equals(targetUrl)) {
            webView.post(() -> webView.loadUrl(targetUrl));
        }
    }

    private void webViewPost(String target) {
        WebView webView = bridge != null ? bridge.getWebView() : null;
        if (webView == null) return;
        webView.post(() -> {
            if (!target.equals(webView.getUrl())) webView.loadUrl(target);
        });
    }
}
