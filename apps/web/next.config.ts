import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Cache Components: `use cache` + `cacheLife` for public content, Partial
  // Prerendering for routes that mix a static shell with request-time data.
  cacheComponents: true,
  partialPrefetching: true,
  typedRoutes: true,
  poweredByHeader: false,
  reactStrictMode: true,
  // Internal workspace packages ship TypeScript source.
  transpilePackages: ['@velasia/contracts', '@velasia/ui'],
  // US spelling of the first booking step, and the short checkout URL.
  async redirects() {
    return [
      { source: '/booking/travelers', destination: '/booking/travellers', permanent: true },
      { source: '/checkout', destination: '/booking/checkout', permanent: false },
    ];
  },
  images: {
    // All imagery is local (public/images); trim variants to what layouts use.
    deviceSizes: [640, 828, 1080, 1280, 1600, 1920],
    imageSizes: [128, 256, 384],
    qualities: [70, 80],
  },
};

export default nextConfig;
