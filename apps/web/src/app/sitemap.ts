import type { MetadataRoute } from 'next';
import { getDestinations } from '@/lib/content';
import { getServerEnv } from '@/lib/env';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getServerEnv().SITE_URL;
  const staticPaths = [
    '/',
    '/destinations',
    '/flights',
    '/help',
    '/manage-booking',
    '/about',
    '/credits',
  ];
  const destinations = await getDestinations();
  return [
    ...staticPaths.map((path) => ({ url: new URL(path, base).toString() })),
    ...destinations.map((destination) => ({
      url: new URL(`/destinations/${destination.slug}`, base).toString(),
    })),
  ];
}
