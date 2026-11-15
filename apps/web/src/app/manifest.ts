import type { MetadataRoute } from 'next';
import { site } from '@/lib/site';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.name,
    short_name: site.shortName,
    description: site.description,
    start_url: '/',
    display: 'standalone',
    background_color: '#FFFFFF',
    theme_color: site.themeColor,
    icons: [
      { src: site.brand.favicon, sizes: 'any', type: 'image/svg+xml' },
      { src: site.brand.icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: site.brand.appleTouchIcon, sizes: '180x180', type: 'image/png' },
    ],
  };
}
