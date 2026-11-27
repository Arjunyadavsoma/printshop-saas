import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // F-07 fix: Do not ignore build errors — type safety is a release gate.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
  // Security: remove the X-Powered-By header (reveals tech stack).
  poweredByHeader: false,
  // Compress responses (Vercel also does this, but explicit for self-hosted).
  compress: true,
  // Image optimization: cache optimized images for 30 days, allow AVIF +
  // WebP. Vercel handles the CDN distribution; this config controls the
  // optimization pipeline.
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
  },
  // Headers: aggressive caching for immutable static assets (_next/static/*
  // is content-hashed — the URL changes when the content changes, so a
  // long max-age is safe + eliminates redundant round-trips on repeat
  // visits). This is the single biggest perf win for returning visitors:
  // without it, the browser re-validates every chunk on every navigation.
  async headers() {
    return [
      {
        // Hashed static assets — immutable, cache for 1 year (industry
        // standard for content-hatched filenames).
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        // Service worker — NEVER cache (must always fetch fresh so updates
        // are picked up immediately).
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
      {
        // Icons + manifest — cache for 1 day (not immutable, can change).
        source: '/icons/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400' },
        ],
      },
    ];
  },
};

export default nextConfig;
