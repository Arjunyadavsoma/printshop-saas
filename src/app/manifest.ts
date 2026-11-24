import type { MetadataRoute } from 'next';

/**
 * Web App Manifest — makes Printelyx installable on mobile (Android Chrome,
 * iOS Safari) + Windows (Edge/Chrome) as a standalone PWA.
 *
 * The manifest serves BOTH the shopkeeper portal AND the customer flow
 * (the primary PWA use case: scan QR → upload → pay → track). Colors
 * match the shipped design tokens: accent #0A58D6 on Clear ground #F2F3F7.
 *
 * The service worker (public/sw.js) caches the app shell for offline use.
 * API calls are NEVER cached (always network) so orders/payments are fresh.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Printelyx — Local Printing Marketplace',
    short_name: 'Printelyx',
    description:
      'Scan a shop QR, upload files, choose print options, pay via UPI (0% commission), and track your order until pickup.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'any',
    background_color: '#F2F3F7', // Clear ground — the background the installed app shows
    theme_color: '#0A58D6', // Accent — matches the app's buttons and theme-color meta (audit P2-8)
    lang: 'en',
    dir: 'ltr',
    categories: ['business', 'productivity', 'utilities', 'shopping'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-source.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    shortcuts: [
      {
        name: 'My Orders',
        short_name: 'Orders',
        description: 'Track your recent print orders',
        url: '/orders',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'Shopkeeper Login',
        short_name: 'Login',
        description: 'Open the shopkeeper portal login page',
        url: '/shop/login',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'Help',
        short_name: 'Help',
        description: 'FAQs and support',
        url: '/help',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
    ],
    screenshots: [],
    related_applications: [],
    prefer_related_applications: false,
  };
}
