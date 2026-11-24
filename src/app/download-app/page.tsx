import type { Metadata } from 'next';
import { DownloadAppClient } from './download-app-client';

export const metadata: Metadata = {
  title: 'Download the Android Companion App',
  description:
    'Install the Printelyx Companion Android app for native camera scanning, UPI payment, and order-ready notifications.',
  robots: { index: true, follow: true },
  alternates: { canonical: '/download-app' },
};

/**
 * /download-app — landing page for the Printelyx Companion Android APK.
 *
 * The APK is built by the `.github/workflows/build-android.yml` GitHub
 * Actions workflow on every push to `main`. The workflow uploads the APK
 * as both a workflow artifact AND a GitHub Release (tagged
 * `companion-v<run_number>`).
 *
 * This page renders:
 *   - An install button linking to the latest GitHub Release download
 *   - A QR code of the download URL (scan from your phone to install)
 *   - Step-by-step install instructions (enable unknown sources, etc.)
 *   - Feature highlights (native camera, UPI intent, notifications)
 *   - The app's SHA-256 checksum for integrity verification
 *
 * The page is a Server Component wrapper around the DownloadAppClient
 * (which handles the GitHub API fetch for the latest release URL +
 * renders the QR code client-side).
 */
export default function DownloadAppPage() {
  return <DownloadAppClient />;
}
