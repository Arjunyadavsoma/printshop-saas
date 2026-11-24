import type { Metadata, Viewport } from "next";
import { Instrument_Sans } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import "./clear.css";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/components/portal/auth-context";
import { PWARegister } from "@/components/pwa/pwa-register";
import { ThemeProvider } from "next-themes";

/**
 * Printelyx "Clear" design system — Instrument Sans only (English only).
 * Replaces Anek Latin + Devanagari + Telugu (Hindi/Telugu content removed).
 */
const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-instrument",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://printelyx.cc.cd'),
  title: {
    default: "Printelyx — Local Printing Marketplace",
    template: "%s · Printelyx",
  },
  description:
    "Scan a shop QR, upload files, choose print options, pay via UPI (0% commission), and track your order until pickup.",
  applicationName: "Printelyx",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-source.svg", sizes: "any", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    siteName: "Printelyx",
    title: "Printelyx — Local Printing Marketplace",
    description:
      "Scan a shop QR, upload files, choose print options, pay via UPI (0% commission), and track your order until pickup.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Printelyx — print without the queue" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Printelyx — Local Printing Marketplace",
    description: "Scan a shop QR, upload files, and pay the print shop directly by UPI. 0% commission.",
    images: ["/og.png"],
  },
  appleWebApp: { capable: true, title: "Printelyx", statusBarStyle: "default" },
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0A58D6" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0B0D" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Native bridges for the Printelyx Companion Android app. */}
        <Script src="/native-bridges.js" strategy="beforeInteractive" />
        {/* FOUC prevention: set dark class before paint */}
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var stored = localStorage.getItem('theme');
                  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  var isDark = stored === 'dark' || (!stored && prefersDark);
                  if (isDark) document.documentElement.classList.add('dark');
                  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body
        suppressHydrationWarning
        className={`${instrumentSans.variable} antialiased bg-background text-foreground`}
      >
        <AuthProvider>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>{children}</ThemeProvider>
        </AuthProvider>
        <Toaster />
        <PWARegister />
      </body>
    </html>
  );
}
