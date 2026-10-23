import type { MetadataRoute } from 'next';

/**
 * Web App Manifest — makes PrintShop installable on mobile (Android Chrome,
 * iOS Safari) + Windows (Edge/Chrome) as a standalone PWA.
 *
 * Next.js serves this at /manifest.webmanifest automatically (the file name
 * `manifest.ts` in the app router is a reserved metadata route).
 *
 * Brand: amber (#d97706 = Tailwind amber-600), matching the shopkeeper
 * portal's sidebar + buttons. Background is white so the splash screen
 * looks clean before the app paints.
 *
 * The shopkeeper is the primary PWA user (daily use); customers scan a QR
 * + pay in-browser without installing anything. start_url is '/' so the
 * shopkeeper lands on the homepage (which links to /shop/login), and the
 * scope covers the whole site so all routes stay in the installed app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PrintShop SaaS — QR Print Shop Management',
    short_name: 'PrintShop',
    description:
      'QR-based print shop management for India. Customers scan, upload files, and pay directly to the shopkeeper\u2019s UPI (0% commission). Shopkeepers manage orders, print via PrintLatch or Native Windows Printer, and track payments.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'any',
    background_color: '#ffffff',
    theme_color: '#d97706', // amber-600 — matches the shop portal chrome
    lang: 'en',
    dir: 'ltr',
    categories: ['business', 'productivity', 'utilities', 'shopping'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        // SVG favicon — modern browsers + a crisp icon at any size.
        src: '/icon-source.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
    shortcuts: [
      {
        name: 'Shopkeeper Login',
        short_name: 'Login',
        description: 'Open the shopkeeper portal login page',
        url: '/shop/login',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'Printer Setup',
        short_name: 'Printer',
        description: 'Configure your print engine (PrintLatch or Native Windows Printer)',
        url: '/shop/printer',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'Customer App',
        short_name: 'Shop',
        description: 'Find a print shop, upload files, pay via UPI',
        url: '/',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
    ],
    screenshots: [],
    related_applications: [],
    prefer_related_applications: false,
  };
}
