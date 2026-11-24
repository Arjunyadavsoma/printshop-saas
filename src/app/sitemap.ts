import type { MetadataRoute } from 'next';

/**
 * Sitemap for the robots-allowed public surfaces. Mirrors public/robots.txt
 * (which disallows /shop/, /admin/, /api/, /orders/ — audit P1-8: robots.txt
 * advertised this file but it 404'd).
 */
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://printelyx.cc.cd';

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    '',
    '/about',
    '/contact',
    '/help',
    '/how-it-works',
    '/pricing',
    '/privacy',
    '/refund-policy',
    '/terms',
    '/track',
    '/download-app',
  ];
  return routes.map((path) => ({
    url: `${BASE_URL}${path}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: path === '' ? 1 : 0.6,
  }));
}
