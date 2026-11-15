import type { MetadataRoute } from 'next';
import { getServerEnv } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  const base = getServerEnv().SITE_URL;
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/'] },
    sitemap: new URL('/sitemap.xml', base).toString(),
  };
}
