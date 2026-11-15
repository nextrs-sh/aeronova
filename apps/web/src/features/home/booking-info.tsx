import { Container } from '@velasia/ui/container';
import {
  ArrowRight,
  BaggageClaim,
  CalendarCog,
  FileCheck2,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { SectionHeading } from '@/components/section-heading';

const ITEMS: { icon: LucideIcon; title: string; description: string; href: Route; cta: string }[] =
  [
    {
      icon: BaggageClaim,
      title: 'Baggage allowance',
      description: 'Cabin and checked allowances, sizes, and what to pack where.',
      href: '/help#baggage',
      cta: 'Baggage guide',
    },
    {
      icon: FileCheck2,
      title: 'Travel documents',
      description: 'Passports, visas, and IDs for domestic and international trips.',
      href: '/help#documents',
      cta: 'Document checklist',
    },
    {
      icon: Smartphone,
      title: 'Check-in',
      description: 'When check-in opens, and how early to arrive at the airport.',
      href: '/help#check-in',
      cta: 'Check-in times',
    },
    {
      icon: CalendarCog,
      title: 'Manage your booking',
      description: 'Changes, seats, and extras after you book — coming soon.',
      href: '/manage-booking',
      cta: 'See what’s coming',
    },
  ];

export function BookingInfo() {
  return (
    <section
      aria-labelledby="booking-info-heading"
      className="border-t border-line bg-surface py-20 lg:py-24"
    >
      <Container>
        <SectionHeading
          id="booking-info-heading"
          eyebrow="Before you fly"
          title="Helpful booking information"
        />
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map(({ icon: Icon, title, description, href, cta }) => (
            <li key={title}>
              <Link
                href={href}
                className="group flex h-full flex-col rounded-card bg-white p-6 ring-1 ring-line transition-shadow hover:shadow-card"
              >
                <Icon className="size-7 text-gold-700" aria-hidden="true" />
                <h3 className="mt-4 text-lg font-bold text-ink">{title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-muted">{description}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-navy-700 group-hover:text-gold-800">
                  {cta}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
