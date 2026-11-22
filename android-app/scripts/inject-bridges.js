/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * inject-bridges.js — bundle the TS bridges into a single IIFE that runs
 * synchronously in the WebView before the web app's scripts.
 *
 * This is a simple concatenation bundler (no webpack/esbuild needed) that:
 *   1. Reads the compiled `dist/injector.js` (output of `tsc`).
 *   2. Wraps it in an IIFE that runs immediately on page load.
 *   3. Writes it to `dist/native-bridges.js` — which Capacitor's `cap sync`
 *      copies into the Android project's `assets/` folder.
 *   4. Registers it as a document-start injection script in the WebView
 *      (via the MainActivity's WebViewClient — configured in Task 4).
 *
 * The script MUST run before the web app's React hydration so that
 * `window.NativeApp` is defined by the time the first useEffect fires.
 * Android WebView's `evaluateJavascript(..., null, true)` with the
 * `insertAtDocumentStart` flag (API 33+) guarantees this.
 */
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const injectorPath = path.join(distDir, 'injector.js');
const outputPath = path.join(distDir, 'native-bridges.js');

if (!fs.existsSync(injectorPath)) {
  console.error('inject-bridges: injector.js not found — run `tsc` first.');
  process.exit(1);
}

// Read the compiled injector (it's an ES module with `export` statements).
// We strip the `export { NativeApp }` line (ESM exports don't work in a
// document-start script context) + wrap the whole thing in an IIFE.
const compiled = fs.readFileSync(injectorPath, 'utf8');

// Remove ESM export syntax — the bridges attach to window.NativeApp directly,
// so no exports are needed.
const stripped = compiled
  .replace(/export\s*\{[^}]*\};?\s*/g, '')
  .replace(/export\s+(async\s+)?function\s+/g, '$1function ')
  .replace(/export\s+const\s+/g, 'const ')
  .replace(/export\s+default\s+/g, '')
  .replace(/^import\s+.*$/gm, '// (import stripped — resolved by bundler)');

// Resolve the @capacitor/* imports at runtime. The Capacitor runtime is
// already loaded in the WebView (capacitor.js is injected by the Android
// project's Capacitor plugin), so the imports resolve to the global
// `Capacitor` object. We polyfill the module map here.
const header = `
// PrintShop Companion — native bridges (auto-generated, do not edit)
// Injected at document-start via Capacitor's WebView plugin.
(function() {
  // Capacitor plugin modules are exposed on the global Capacitor object.
  // The imports in the TS source (@capacitor/camera, etc.) resolve to these.
  const Capacitor = window.Capacitor;
  if (!Capacitor) {
    console.warn('[NativeApp] Capacitor runtime not loaded — bridges disabled.');
    return;
  }
`;

const footer = `
})();
`;

const bundle = header + stripped + footer;

// Ensure dist exists
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(outputPath, bundle, 'utf8');
console.log(`inject-bridges: wrote ${outputPath} (${bundle.length} bytes)`);

// Also copy the bundle to the Next.js web app's public/ directory so the
// deployed web app serves it at /native-bridges.js. The web app loads it
// via a <Script strategy="beforeInteractive"> tag in the root layout —
// this guarantees the bridges are available before React hydration.
//
// The script self-initializes ONLY when window.Capacitor exists (set by
// the Capacitor Android runtime). In a regular browser, Capacitor is
// absent → the script does nothing → no performance impact on web users.
const webPublicDir = path.join(__dirname, '..', '..', 'public');
const webDestPath = path.join(webPublicDir, 'native-bridges.js');
fs.mkdirSync(webPublicDir, { recursive: true });
fs.copyFileSync(outputPath, webDestPath);
console.log(`inject-bridges: copied to web app public dir → ${webDestPath}`);
