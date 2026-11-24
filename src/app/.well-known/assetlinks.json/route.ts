import { NextRequest } from 'next/server';

/**
 * GET /.well-known/assetlinks.json — Android App Links verification.
 *
 * Android fetches this file from https://printelyx.cc.cd to decide whether
 * https links to this domain open in the PrintShop Companion app
 * (app.printshop.companion) instead of the browser. The manifest's
 * autoVerify intent-filter pairs with this file.
 *
 * The statement is only valid with the app's signing certificate SHA-256
 * fingerprint. Set ANDROID_CERT_SHA256 (colon-separated, exactly what
 * `keytool -list -v -keystore <keystore>` prints under SHA256) in the
 * deployment env — multiple fingerprints can be comma-separated (debug +
 * release). Without it, the route returns the statement with an empty
 * fingerprint list: well-formed JSON, but Android will not verify (links
 * fall back to the browser) — never fake verification.
 */
export async function GET(_req: NextRequest) {
  const raw = process.env.ANDROID_CERT_SHA256 ?? '';
  const fingerprints = raw
    .split(',')
    .map((f) => f.trim().replace(/\s+/g, '').toUpperCase())
    .filter((f) => /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/.test(f));

  return new Response(
    JSON.stringify(
      [
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: {
            namespace: 'android_app',
            package_name: 'app.printshop.companion',
            sha256_cert_fingerprints: fingerprints,
          },
        },
      ],
      null,
      2,
    ),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Let Google/Android caches + the Digital Asset Links crawler read it.
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}
