import type { Metadata, Viewport } from 'next';
import { Inter, Manrope } from 'next/font/google';
import type { ReactNode } from 'react';
import { DemoNotice } from '@/components/layout/demo-notice';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { getServerEnv } from '@/lib/env';
import { site } from '@/lib/site';
import './globals.css';

const textFont = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-text',
  display: 'swap',
});
// Manrope is also the typeface of the outlined Velasia wordmark.
const headingFont = Manrope({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-heading',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(getServerEnv().SITE_URL),
  title: {
    default: site.title,
    template: `%s | ${site.name}`,
  },
  description: site.description,
  applicationName: site.name,
  icons: {
    icon: [{ url: site.brand.favicon, type: 'image/svg+xml' }],
    apple: [{ url: site.brand.appleTouchIcon, sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    type: 'website',
    siteName: site.name,
    locale: site.locale,
    title: site.title,
    description: site.description,
    images: [site.brand.socialPreview],
  },
  twitter: {
    card: 'summary_large_image',
    title: site.title,
    description: site.description,
    images: [site.brand.socialPreview],
  },
};

export const viewport: Viewport = {
  themeColor: site.themeColor,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Browser extensions (password managers, passkey bridges) add attributes to <html> before
    // React hydrates. This silences only this element's own attributes, not its children.
    <html
      lang="en"
      className={`${textFont.variable} ${headingFont.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded-full bg-navy-950 px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <DemoNotice />
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
