/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * inject-bridges.js — bundle the TS bridges into a single IIFE that runs
 * synchronously in the WebView before the web app's scripts.
 *
 * v1.2 NOTE — this was previously NOT a bundler: it read only
 * dist/injector.js, so the bridge modules (camera, upi, storage,
 * notifications — and now location, settings) were never included. The
 * generated bundle referenced `scanDocument` and friends without ever
 * defining them → the IIFE threw a ReferenceError while evaluating the
 * NativeApp object literal → `window.NativeApp` NEVER attached. Every
 * native feature silently fell back to the web path. This was the root
 * bug of v1.1's injection fix.
 *
 * Now it:
 *   1. Reads EVERY compiled module under dist/ (tsc emits one .js per .ts,
 *      ESM imports still present).
 *   2. Strips ESM import/export syntax per module.
 *   3. Concatenates all modules into ONE scope (injector last, so the
 *      NativeApp object literal evaluates after every function is defined;
 *      function declarations hoist within the scope anyway).
 *   4. Binds the stripped `@capacitor/*` imports to the Capacitor runtime
 *      globals (window.Capacitor.Plugins.*) + re-creates the two camera
 *      enums, which @capacitor/camera ships as module constants — not
 *      runtime plugin proxies.
 *   5. Wraps everything in an IIFE guarded by `window.Capacitor` so the
 *      bundle is a no-op in regular browsers (web users unaffected).
 *
 * The bundle is written to dist/native-bridges.js (cap sync copies it into
 * the Android assets) and copied to ../public/ so the deployed web app
 * serves it at /native-bridges.js (loaded by the root layout's
 * beforeInteractive <Script> tag — MainActivity additionally injects the
 * asset at document start as a belt-and-braces measure for cold starts).
 */
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const outputPath = path.join(distDir, 'native-bridges.js');

if (!fs.existsSync(distDir)) {
  console.error('inject-bridges: dist/ not found — run `tsc` first.');
  process.exit(1);
}

// Collect compiled modules; injector.js MUST come last (it references the
// others at top level while building the NativeApp object literal).
const moduleFiles = fs
  .readdirSync(distDir, { recursive: true })
  .filter((f) => f.endsWith('.js') && path.basename(f) !== 'native-bridges.js')
  .sort((a, b) => (a.endsWith('injector.js') ? 1 : b.endsWith('injector.js') ? -1 : a.localeCompare(b)));

if (!moduleFiles.some((f) => f.endsWith('injector.js'))) {
  console.error('inject-bridges: dist/injector.js missing — did tsc run?');
  process.exit(1);
}

function stripEsm(source) {
  return (
    source
      // import lines (tsc emits them single-line for ESNext)
      .replace(/^import\s+[^;]*;?\s*$/gm, '')
      // export keywords on declarations
      .replace(/export\s*\{[^}]*\};?\s*/g, '')
      .replace(/export\s+(async\s+)?function\s+/g, '$1function ')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+default\s+/g, '')
  );
}

const header = `
// PrintShop Companion — native bridges (auto-generated, do not edit)
// Bundled by scripts/inject-bridges.js from src/ — includes ALL bridge
// modules (camera, upi, storage, notifications, location, settings).
(function() {
  var Capacitor = window.Capacitor;
  if (!Capacitor) {
    // Regular browser — no Capacitor runtime, leave window.NativeApp
    // undefined so the web app uses its own fallbacks. No-op.
    return;
  }
  // Module map — the bundler strips the @capacitor/* imports; bind the
  // same names to the runtime globals here.
  var Camera = Capacitor.Plugins.Camera;
  var Geolocation = Capacitor.Plugins.Geolocation;
  var LocalNotifications = Capacitor.Plugins.LocalNotifications;
  var Preferences = Capacitor.Plugins.Preferences;
  var registerPlugin = function(name) { return Capacitor.Plugins[name]; };
  // Enum constants from @capacitor/camera (module constants, not plugins).
  var CameraResultType = { Base64: 'base64', DataUrl: 'dataUrl', Uri: 'uri' };
  var CameraSource = { Prompt: 'PROMPT', Camera: 'CAMERA', Photos: 'PHOTOS' };
`;

const footer = `
})();
`;

const parts = [header];
for (const file of moduleFiles) {
  const src = fs.readFileSync(path.join(distDir, file), 'utf8');
  parts.push(`\n// ===== module: ${file} =====\n`);
  parts.push(stripEsm(src));
}
parts.push(footer);

const bundle = parts.join('\n');

fs.writeFileSync(outputPath, bundle, 'utf8');
console.log(`inject-bridges: wrote ${outputPath} (${bundle.length} bytes, ${moduleFiles.length} modules)`);

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

// Fail the build loudly if the bundle still references unknown capitalized
// identifiers: every stripped import name must be defined in the module
// map or be a standard JS global (Date, Error, Promise, ...).
const defined = new Set(
  [...bundle.matchAll(/(?:var|const|let|function)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
);
const moduleMapNames = new Set([
  'Capacitor', 'Camera', 'Geolocation', 'LocalNotifications', 'Preferences',
  'registerPlugin', 'CameraResultType', 'CameraSource',
]);
const moduleBaseNames = new Set(moduleFiles.map((f) => path.basename(f, '.js')));
// Check comments-free code and ignore property access (the name after a
// dot — e.g. Plugins in Capacitor.Plugins — is a property, not a binding).
const checkSrc = bundle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const unresolved = new Set();
for (const m of checkSrc.matchAll(/(?<![.\w$'"`])([A-Z][A-Za-z$][\w$]*)\s*\./g)) {
  const n = m[1];
  if (moduleMapNames.has(n) || defined.has(n)) continue;
  // Standard globals exist in Node too (Date, Error, Promise, JSON, Math…)
  if (typeof globalThis[n] !== 'undefined') continue;
  unresolved.add(n);
}
if (unresolved.size) {
  console.error(
    `inject-bridges: unresolved identifiers — extend the module map in inject-bridges.js: ${[...unresolved].join(', ')}`,
  );
  process.exit(1);
}
console.log(`inject-bridges: module map OK (${moduleFiles.length} modules: ${[...moduleBaseNames].join(', ')})`);
