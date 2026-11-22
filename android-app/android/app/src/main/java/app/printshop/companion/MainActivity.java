package app.printshop.companion;

import com.getcapacitor.BridgeActivity;

/**
 * Main entry activity for the PrintShop Companion app.
 *
 * Extends Capacitor's BridgeActivity, which:
 *   - Creates the WebView that loads the deployed Next.js consumer app
 *     (configured via capacitor.config.ts → server.url)
 *   - Registers the Capacitor plugins (Camera, Preferences, etc.)
 *   - Handles the JavaScript ↔ Java bridge
 *
 * The UPIIntentPlugin is registered here (see the onCreate override below)
 * so the TypeScript `upi.ts` bridge can call `UPIPlugin.pay({ upiUri })`
 * which resolves to the Java `pay()` method.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Register the custom UPI Intent plugin. The string "UPIIntent"
        // MUST match the plugin name in `upi.ts`'s `registerPlugin('UPIIntent')`.
        registerPlugin(UPIIntentPlugin.class);
    }
}
