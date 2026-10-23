/**
 * GET /api/v1/downloads/native-printer
 *
 * Streams a ZIP of the PrintShop Native Windows Printer service so the
 * shopkeeper can download it directly from the website (no GitHub
 * navigation / branch confusion — every shopkeeper gets the exact same
 * version + file layout as the one this deployment ships with).
 *
 * The ZIP contains:
 *   - index.js       (the service code)
 *   - package.json    (dependency list — `npm install` reads this)
 *   - README.md       (shopkeeper guide, with the CURRENT origin injected
 *                       so the pairing command inside it matches this
 *                       deployment exactly)
 *   - .gitignore      (so node_modules + .pairing-state.json stay local)
 *   - install.bat     (Windows double-click helper — runs `npm install`)
 *   - pair.bat        (Windows double-click helper — runs the pairing
 *                       command with the correct --origin pre-filled —
 *                       eliminates typing errors)
 *   - start.bat       (Windows double-click helper — runs `node index.js`)
 *
 * Extracting the ZIP creates a `native-printer/` folder. The shopkeeper
 * moves it to a permanent location (e.g. C:\PrintShop\native-printer) and
 * follows the 7-step guide on the Printer Setup page.
 *
 * PUBLIC endpoint — no auth. The source files are already public on
 * GitHub; bundling them here is purely for convenience + version pinning.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';

// Force runtime = nodejs (jszip needs the Node fs/path primitives + we read
// from the repo at request time). Edge runtime can't read the filesystem.
export const runtime = 'nodejs';
// Cache the zipped bytes for 1 hour — the contents only change on redeploy,
// so a short cache cuts repeated zip-generation cost on the serverless fn.
export const revalidate = 3600;

const SOURCE_DIR = join(process.cwd(), 'mini-services', 'native-printer');

/**
 * Determine the canonical origin of THIS deployment from the request.
 * Vercel sets `x-forwarded-host` + `x-forwarded-proto`; in local dev the
 * plain `host` header is enough. Falls back to the production URL.
 */
function getOrigin(req: NextRequest): string {
  const xfProto = req.headers.get('x-forwarded-proto');
  const xfHost = req.headers.get('x-forwarded-host');
  const host = xfHost ?? req.headers.get('host');
  const proto = xfProto ?? (host?.startsWith('localhost') ? 'http' : 'https');
  if (host) return `${proto}://${host}`;
  return 'https://printshop-saas-three.vercel.app';
}

/** Inject the current origin into the README (replaces the example URL). */
function customizeReadme(content: string, origin: string): string {
  // Replace any hard-coded example origin with the real one. The README
  // uses the production URL as an example — swap it for the deployment's
  // actual origin so the pairing command in the downloaded README matches
  // the website the shopkeeper is using.
  return content.replace(
    /https:\/\/printshop-saas-three\.vercel\.app/g,
    origin,
  );
}

/**
 * Generate a Windows .bat helper. `pair.bat` runs the pairing command with
 * the correct --origin pre-filled (no typing). `start.bat` starts the
 * service. `install.bat` runs npm install. All pause at the end so the
 * window doesn't auto-close on error.
 */
function pairBat(origin: string): string {
  return [
    '@echo off',
    'REM PrintShop Native Printer - pairing helper (auto-generated)',
    'REM Runs: node index.js pair --origin=<this-website>',
    'REM',
    'REM After running this, copy the printed pairing code + paste it on',
    'REM the PrintShop website Printer Setup page, then run start.bat',
    '',
    `node index.js pair --origin=${origin}`,
    '',
    'if %ERRORLEVEL% NEQ 0 (',
    '  echo.',
    '  echo Pairing failed. See the error above.',
    ') else (',
    '  echo.',
    '  echo Pairing code printed above. Paste it on the PrintShop website,',
    '  echo then run start.bat to start the service.',
    ')',
    '',
    'pause',
    '',
  ].join('\r\n');
}

function startBat(): string {
  return [
    '@echo off',
    'REM PrintShop Native Printer - service start helper (auto-generated)',
    'REM Runs: node index.js',
    'REM',
    'REM Keep this window open while printing!',
    '',
    'node index.js',
    '',
    'if %ERRORLEVEL% NEQ 0 (',
    '  echo.',
    '  echo Service stopped with an error. See the output above.',
    ')',
    '',
    'pause',
    '',
  ].join('\r\n');
}

function installBat(): string {
  return [
    '@echo off',
    'REM PrintShop Native Printer - dependency installer (auto-generated)',
    'REM Runs: npm install   (one-time, after first download)',
    '',
    'call npm install',
    '',
    'if %ERRORLEVEL% NEQ 0 (',
    '  echo.',
    '  echo npm install failed. Make sure Node.js 22+ is installed',
    '  echo (https://nodejs.org/). Run:  node --version',
    ') else (',
    '  echo.',
    '  echo Dependencies installed. Now run pair.bat to get a pairing code.',
    ')',
    '',
    'pause',
    '',
  ].join('\r\n');
}

export async function GET(req: NextRequest) {
  const origin = getOrigin(req);

  let indexJs: string;
  let packageJson: string;
  let readmeMd: string;
  let gitignore: string;

  try {
    indexJs = readFileSync(join(SOURCE_DIR, 'index.js'), 'utf8');
    packageJson = readFileSync(join(SOURCE_DIR, 'package.json'), 'utf8');
    readmeMd = customizeReadme(
      readFileSync(join(SOURCE_DIR, 'README.md'), 'utf8'),
      origin,
    );
    gitignore = readFileSync(join(SOURCE_DIR, '.gitignore'), 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'read_failed', message: `Could not read source files: ${msg}` } },
      { status: 500 },
    );
  }

  // Build the ZIP. Files go under `native-printer/` so extraction creates a
  // single top-level folder (no "zip bomb" of loose files in the user's
  // Downloads folder).
  const zip = new JSZip();
  const folder = zip.folder('native-printer');
  if (!folder) {
    return NextResponse.json(
      { error: { code: 'zip_failed', message: 'Could not create ZIP folder' } },
      { status: 500 },
    );
  }
  folder.file('index.js', indexJs);
  folder.file('package.json', packageJson);
  folder.file('README.md', readmeMd);
  folder.file('.gitignore', gitignore);
  // Windows double-click helpers — eliminate typing errors for the 3
  // commands the shopkeeper runs most.
  folder.file('install.bat', installBat());
  folder.file('pair.bat', pairBat(origin));
  folder.file('start.bat', startBat());

  // Generate the ZIP as a Uint8Array (jszip returns a Buffer-like).
  const zipBytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  // Filename includes the version (from package.json) so the shopkeeper can
  // tell which version they downloaded. Falls back to a date if parse fails.
  let version = '1.0.0';
  try {
    const pkg = JSON.parse(packageJson);
    if (typeof pkg.version === 'string') version = pkg.version;
  } catch {
    /* keep default */
  }
  const filename = `printshop-native-printer-v${version}.zip`;

  return new NextResponse(zipBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
