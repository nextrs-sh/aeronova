import { airline } from '@velasia/contracts';
import type { Route } from 'next';

/** Storefront copy and assets, derived from the shared airline identity in `@velasia/contracts`. */
export const site = {
  name: airline.name,
  shortName: airline.shortName,
  tagline: airline.tagline,
  /** Default document title. */
  title: `${airline.name} | Beyond Every Horizon`,
  description: `Explore destinations and discover your next journey with ${airline.name}, a fictional modern airline retailing experience.`,
  disclaimer: airline.disclaimer,
  locale: 'en_PH',
  themeColor: '#101E38',
  brand: {
    logo: '/brand/velasia-logo.svg',
    favicon: '/brand/velasia-favicon.svg',
    appleTouchIcon: '/brand/velasia-apple-touch-icon.png',
    icon512: '/brand/velasia-icon-512.png',
    socialPreview: {
      url: '/brand/velasia-social-preview.png',
      width: 1200,
      height: 630,
      alt: `${airline.name} — ${airline.tagline}`,
    },
  },
} as const;

export interface NavItem {
  href: Route;
  label: string;
}

export const primaryNav: NavItem[] = [
  { href: '/flights', label: 'Book flights' },
  { href: '/destinations', label: 'Explore destinations' },
  { href: '/manage-booking', label: 'Manage booking' },
  { href: '/help', label: 'Help' },
];

export const footerNav: { title: string; items: NavItem[] }[] = [
  {
    title: 'Book',
    items: [
      { href: '/flights', label: 'Search flights' },
      { href: '/destinations', label: 'Destinations' },
      { href: '/manage-booking', label: 'Manage booking' },
    ],
  },
  {
    title: 'Help',
    items: [
      { href: '/help', label: 'Help centre' },
      { href: '/help#baggage', label: 'Baggage' },
      { href: '/help#documents', label: 'Travel documents' },
      { href: '/help#contact', label: 'Contact us' },
    ],
  },
  {
    title: airline.shortName,
    items: [
      { href: '/about', label: 'About this demo' },
      { href: '/credits', label: 'Photo credits' },
    ],
  },
];
