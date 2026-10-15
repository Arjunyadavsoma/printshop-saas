import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PrintShop SaaS — QR-based print shop management for India",
  description: "Adapter-pattern SaaS for Indian print/Xerox shops. Customers scan, upload, and pay directly to the shopkeeper's UPI (0% commission). Phase 1 foundation: pricing engine, 9 adapter interfaces, 35 passing tests.",
  keywords: ["print shop", "SaaS", "India", "UPI", "QR", "adapter pattern", "Next.js", "TypeScript"],
  authors: [{ name: "PrintShop SaaS" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "PrintShop SaaS",
    description: "QR-based print shop management for the Indian market — 0% commission, adapter-pattern architecture.",
    url: "https://chat.z.ai",
    siteName: "PrintShop SaaS",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PrintShop SaaS",
    description: "QR-based print shop management for the Indian market.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
