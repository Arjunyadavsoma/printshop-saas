import type { Metadata, Viewport } from "next";
import { Inter, Manrope } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import "./clear.css";
import "./auth.css";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/components/portal/auth-context";
import { PWARegister } from "@/components/pwa/pwa-register";
import { ThemeProvider } from "next-themes";
import { ClerkProvider } from "@clerk/nextjs";
import { isClerkEnabled } from "@/lib/clerk";

/**
 * Printelyx Consumer Visual Identity — Inter is the primary typeface.
 * Exposed as `--font-inter` (canonical, per the identity doc) and
 * `--font-instrument` (backward-compat alias so the existing Clear CSS,
 * which references var(--font-instrument), renders in Inter without edits).
 * Manrope remains the consumer-flow display face.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
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
  // Single light entry: the Clear design has no dark mode (the PDF is
  // light-only and .ref-* hardcodes light colours), so the browser chrome
  // must never advertise a dark theme.
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#2563EB" }],
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
        {/*
          No theme-init script: the previous script added the `dark` class
          whenever the OS preferred dark mode (or a stored 'dark' theme
          existed), which painted the ground outside the light-only
          `.ref-*` / Clear surfaces near-black (#0B0B0D). The Clear design
          has no dark mode, so dark must never be auto-enabled.
        */}
      </head>
      <body
        suppressHydrationWarning
        className={`${inter.variable} ${manrope.variable} antialiased bg-background text-foreground`}
        style={{ ['--font-instrument' as string]: 'var(--font-inter)' } as React.CSSProperties}
      >
        <AuthProvider>
          {/*
            Light is forced: `forcedTheme="light"` makes next-themes ignore
            both the OS preference and any stored 'dark' choice, and renders
            any ThemeToggle inert. A manual dark toggle cannot work without
            breaking the light-only Clear design (light-only `.ref-*`
            surfaces inside a dark app), so there is no working toggle by
            design. Revisit only if a real dark mode is designed — the
            `.dark` token block in globals.css is kept for that day.
          */}
          <ThemeProvider attribute="class" forcedTheme="light" disableTransitionOnChange>
            {/*
              Clerk (Google sign-in) is mounted only when its keys are set
              (`isClerkEnabled()` — see src/lib/clerk.ts). Without keys the
              tree renders exactly as before: the JWT email+password login
              is the only sign-in, and no Clerk SDK code runs. Clerk is an
              additional way in during the migration, not a replacement —
              the JWT session behind `withAuth` is unchanged.
            */}
            {isClerkEnabled() ? (
              <ClerkProvider>{children}</ClerkProvider>
            ) : (
              children
            )}
          </ThemeProvider>
        </AuthProvider>
        <Toaster />
        <PWARegister />
      </body>
    </html>
  );
}
