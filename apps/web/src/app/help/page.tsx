import { Container } from '@velasia/ui/container';
import { ChevronDown } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageIntro } from '@/components/page-intro';
import { pageMetadata } from '@/lib/metadata';

export const metadata: Metadata = pageMetadata({
  title: 'Help centre',
  description:
    'Baggage, travel documents, check-in, and contact information for Velasia Airways travellers.',
  path: '/help',
});

const TOPICS = [
  {
    id: 'baggage',
    title: 'Baggage',
    questions: [
      {
        q: 'How much cabin baggage can I bring?',
        a: 'Every fare includes one cabin bag up to 7 kg (56 × 36 × 23 cm) plus a small personal item that fits under the seat in front of you.',
      },
      {
        q: 'Is checked baggage included?',
        a: 'Checked baggage depends on the fare bundle you choose. Classic includes 20 kg and Flex includes 30 kg. You will be able to add bags to Lite fares at booking.',
      },
      {
        q: 'Can I travel with sports equipment or a stroller?',
        a: 'Yes. Strollers and car seats for infants travel free of charge. Surfboards, golf bags, and bikes count as special baggage and must be added before travel.',
      },
    ],
  },
  {
    id: 'documents',
    title: 'Travel documents',
    questions: [
      {
        q: 'What ID do I need for domestic flights?',
        a: 'Adults need a valid government-issued photo ID. Children may travel with a school ID or a copy of their birth certificate.',
      },
      {
        q: 'What do I need for international flights?',
        a: 'A passport valid for at least six months beyond your travel dates, plus any visa required by your destination. Always check the latest entry requirements before you fly.',
      },
    ],
  },
  {
    id: 'check-in',
    title: 'Check-in',
    questions: [
      {
        q: 'When does check-in open?',
        a: 'Online check-in opens 48 hours and closes 1 hour before departure. Airport counters open 3 hours before international and 2 hours before domestic flights.',
      },
      {
        q: 'How early should I arrive at the airport?',
        a: 'We recommend arriving 2 hours before domestic and 3 hours before international departures to allow time for security and immigration.',
      },
    ],
  },
];

export default function HelpPage() {
  return (
    <>
      <PageIntro
        eyebrow="Help centre"
        title="How can we help?"
        description="Answers to common questions before you fly. Velasia Airways is a fictional airline, so these policies are examples for this demo."
      />
      <Container className="grid gap-12 py-14 lg:grid-cols-[14rem_minmax(0,1fr)] lg:py-20">
        <nav aria-label="Help topics" className="lg:sticky lg:top-28 lg:self-start">
          <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
            {[...TOPICS, { id: 'contact', title: 'Contact us' }].map((topic) => (
              <li key={topic.id}>
                <a
                  href={`#${topic.id}`}
                  className="block rounded-full px-4 py-2 text-sm font-semibold text-ink-muted ring-1 ring-line hover:bg-surface hover:text-ink lg:rounded-xl lg:ring-0"
                >
                  {topic.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-14">
          {TOPICS.map((topic) => (
            <section
              key={topic.id}
              id={topic.id}
              aria-labelledby={`${topic.id}-heading`}
              className="scroll-mt-28"
            >
              <h2 id={`${topic.id}-heading`} className="text-2xl font-bold text-ink">
                {topic.title}
              </h2>
              <div className="mt-5 divide-y divide-line rounded-card ring-1 ring-line">
                {topic.questions.map((item) => (
                  <details
                    key={item.q}
                    className="group px-5 py-1 [&_summary::-webkit-details-marker]:hidden"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-semibold text-ink">
                      {item.q}
                      <ChevronDown
                        className="size-5 shrink-0 text-ink-subtle transition-transform group-open:rotate-180"
                        aria-hidden="true"
                      />
                    </summary>
                    <p className="pb-5 leading-relaxed text-ink-muted">{item.a}</p>
                  </details>
                ))}
              </div>
            </section>
          ))}

          <section
            id="contact"
            aria-labelledby="contact-heading"
            className="scroll-mt-28 rounded-card bg-navy-950 p-8 text-white"
          >
            <h2 id="contact-heading" className="text-2xl font-bold">
              Contact us
            </h2>
            <p className="mt-3 max-w-2xl leading-relaxed text-navy-100">
              Velasia Airways is a demonstration project, so there is no real contact centre and no
              bookings to support. For questions about the project itself, see{' '}
              <Link href="/about" className="font-semibold text-white underline underline-offset-4">
                About this demo
              </Link>
              .
            </p>
          </section>
        </div>
      </Container>
    </>
  );
}
