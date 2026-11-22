'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Download,
  Camera,
  Smartphone,
  Bell,
  ShieldCheck,
  QrCode,
  ArrowRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';

/**
 * Latest release info fetched from the GitHub API.
 * The workflow tags releases as `companion-v<run_number>`.
 */
interface ReleaseInfo {
  tagName: string;
  name: string;
  publishedAt: string;
  apkUrl: string;        // direct download URL for the APK asset
  releasePageUrl: string; // the GitHub release page URL
  body: string;
}

const GITHUB_OWNER = 'Arjunyadavsoma';
const GITHUB_REPO = 'printshop-saas';

/**
 * Fetch the latest "companion-v*" release from GitHub.
 * The workflow creates a release tagged `companion-v<run_number>` on every
 * push to main. The GitHub API returns the release + its assets; we find
 * the `.apk` asset URL.
 */
async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    // List releases, pick the latest companion-v* tag.
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=10`,
      { next: { revalidate: 300 } }, // cache for 5 min
    );
    if (!res.ok) return null;
    const releases = (await res.json()) as Array<{
      tag_name: string;
      name: string;
      published_at: string;
      html_url: string;
      body: string;
      assets: Array<{
        name: string;
        browser_download_url: string;
        size: number;
      }>;
    }>;
    const companionRelease = releases.find((r) =>
      r.tag_name.startsWith('companion-v'),
    );
    if (!companionRelease) return null;
    const apkAsset = companionRelease.assets.find((a) =>
      a.name.endsWith('.apk'),
    );
    if (!apkAsset) return null;
    return {
      tagName: companionRelease.tag_name,
      name: companionRelease.name ?? companionRelease.tag_name,
      publishedAt: companionRelease.published_at,
      apkUrl: apkAsset.browser_download_url,
      releasePageUrl: companionRelease.html_url,
      body: companionRelease.body ?? '',
    };
  } catch {
    return null;
  }
}

/** Extract the SHA-256 checksum from the release body (if present). */
function extractChecksum(body: string): string | null {
  const match = body.match(/SHA-256[:\s]*`?([a-f0-9]{64})`?/i);
  return match ? match[1] : null;
}

const FEATURES = [
  {
    icon: Camera,
    title: 'Native camera scanning',
    description: 'Scan physical documents directly with your phone camera — no browser file picker.',
  },
  {
    icon: Smartphone,
    title: 'Direct UPI payment',
    description: 'Checkout launches your installed UPI app (PhonePe, GPay, Paytm) via native Android Intent.',
  },
  {
    icon: Bell,
    title: 'Order-ready notifications',
    description: 'Get a push notification when your prints are ready for pickup — no polling required.',
  },
  {
    icon: ShieldCheck,
    title: 'Secure token storage',
    description: 'Auth tokens stored in Android app-private Preferences (sandboxed) — not browser localStorage.',
  },
];

export function DownloadAppClient() {
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await fetchLatestRelease();
      if (r) {
        setRelease(r);
      } else {
        setError('No APK release found yet. The first build may still be running — check back in a few minutes.');
      }
      setLoading(false);
    })();
  }, []);

  const checksum = release ? extractChecksum(release.body) : null;
  // The QR code encodes the APK download URL so the user can scan from their
  // phone to download directly. Using the Google Charts API alternative:
  // api.qrserver.com is a free QR code generator that returns a PNG.
  const qrUrl = release
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(release.apkUrl)}`
    : null;

  return (
    <div className="min-h-screen bg-page">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:py-16">
        {/* Header */}
        <div className="text-center space-y-4 mb-10">
          <div className="inline-flex size-16 items-center justify-center rounded-2xl bg-brand text-brand-foreground shadow-lg">
            <span className="text-2xl font-bold">P</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            PrintShop Companion
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            The Android app that integrates with your print shop — native camera scanning, UPI payment, and order-ready notifications.
          </p>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Smartphone className="size-4" aria-hidden="true" />
            <span>Android 7.0+ (API 24+)</span>
            <span aria-hidden="true">·</span>
            <span>~8 MB APK</span>
          </div>
        </div>

        {/* Download card */}
        <Card className="border-border bg-surface shadow-sm mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="size-5 text-brand" aria-hidden="true" />
              Download the APK
            </CardTitle>
            <CardDescription>
              The APK is built automatically on every push to the main branch via GitHub Actions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                <span className="text-sm">Fetching the latest build…</span>
              </div>
            ) : error ? (
              <div className="flex items-start gap-3 rounded-md border border-warning-border bg-warning-soft p-4">
                <AlertCircle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">No APK available yet</p>
                  <p className="text-sm text-muted-foreground">{error}</p>
                  <Link
                    href={`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
                  >
                    Check the build status on GitHub
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            ) : release ? (
              <>
                <div className="flex flex-col sm:flex-row gap-6 items-start">
                  {/* QR code */}
                  {qrUrl && (
                    <div className="flex flex-col items-center gap-2 shrink-0">
                      <div className="size-60 rounded-lg border border-border bg-white p-3 flex items-center justify-center">
                        <img
                          src={qrUrl}
                          alt="QR code linking to the APK download"
                          width={240}
                          height={240}
                          className="size-full object-contain"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <QrCode className="size-3" aria-hidden="true" />
                        Scan to download on your phone
                      </p>
                    </div>
                  )}

                  {/* Download button + metadata */}
                  <div className="flex-1 space-y-3 w-full">
                    <a href={release.apkUrl} download>
                      <Button
                        className="w-full min-h-[48px] gap-2 bg-brand text-brand-foreground hover:bg-brand-hover"
                        size="lg"
                      >
                        <Download className="size-5" aria-hidden="true" />
                        Download APK
                      </Button>
                    </a>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <p className="flex items-center gap-2">
                        <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                        Version: <span className="font-medium text-foreground">{release.tagName}</span>
                      </p>
                      <p className="flex items-center gap-2">
                        <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                        Released: <span className="font-medium text-foreground">{new Date(release.publishedAt).toLocaleDateString()}</span>
                      </p>
                      {checksum && (
                        <p className="flex items-start gap-2">
                          <CheckCircle2 className="size-4 text-success mt-0.5 shrink-0" aria-hidden="true" />
                          <span className="break-all">
                            SHA-256: <code className="font-mono text-xs">{checksum}</code>
                          </span>
                        </p>
                      )}
                    </div>
                    <Link
                      href={release.releasePageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
                    >
                      View release notes on GitHub
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        {/* Install instructions */}
        <Card className="border-border bg-surface shadow-sm mb-6">
          <CardHeader>
            <CardTitle>Install instructions</CardTitle>
            <CardDescription>
              Android requires explicit permission to install apps from outside the Play Store.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {[
                { step: 'Download the APK', detail: 'Tap "Download APK" above or scan the QR code with your phone camera.' },
                { step: 'Open the downloaded file', detail: 'Tap the notification or find it in your Downloads folder.' },
                { step: 'Allow install from this source', detail: 'Android will prompt "For your security, your phone is not allowed to install unknown apps from this source." Tap Settings → enable "Allow from this source".' },
                { step: 'Install', detail: 'Tap "Install" and wait ~10 seconds for the installation to complete.' },
                { step: 'Open PrintShop Companion', detail: 'Find it in your app drawer. The app loads your print shop\'s web app with native camera + UPI + notifications.' },
              ].map((item, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground text-sm font-bold">
                    {i + 1}
                  </span>
                  <div className="space-y-0.5 pt-0.5">
                    <p className="text-sm font-medium text-foreground">{item.step}</p>
                    <p className="text-sm text-muted-foreground">{item.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        {/* Features */}
        <div className="grid gap-4 sm:grid-cols-2 mb-10">
          {FEATURES.map((f) => (
            <Card key={f.title} className="border-border bg-surface">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                    <f.icon className="size-5" aria-hidden="true" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">{f.title}</p>
                    <p className="text-sm text-muted-foreground">{f.description}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Footer link back to the app */}
        <div className="text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
          >
            <ArrowRight className="size-3" aria-hidden="true" />
            Back to the web app
          </Link>
        </div>
      </div>
    </div>
  );
}
