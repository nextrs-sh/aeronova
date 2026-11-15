import type { Route } from 'next';

export const site = {
  name: 'AeroNova',
  tagline: 'Your journey. Your way.',
  description:
    'Book flights across the Philippines and Southeast Asia with AeroNova — a fictional airline built to explore modern airline retailing.',
  disclaimer:
    'AeroNova is a fictional airline created for demonstration. No real flights, bookings, or payments are offered.',
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
    title: 'AeroNova',
    items: [
      { href: '/about', label: 'About this demo' },
      { href: '/credits', label: 'Photo credits' },
    ],
  },
];
