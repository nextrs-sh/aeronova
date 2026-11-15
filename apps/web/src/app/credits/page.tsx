import { Container } from '@velasia/ui/container';
import type { Metadata } from 'next';
import Image from 'next/image';
import { PageIntro } from '@/components/page-intro';
import { pageMetadata } from '@/lib/metadata';
import { imageCredits } from '@/lib/image-credits';

export const metadata: Metadata = pageMetadata({
  title: 'Photo credits',
  description: 'Attribution for the photography used on the Velasia Airways demo site.',
  path: '/credits',
});

export default function CreditsPage() {
  return (
    <>
      <PageIntro
        eyebrow="Credits"
        title="Photo credits"
        description="All photographs come from Wikimedia Commons and are used under the licences listed below. Images have been resized and, in some cases, cropped."
      />
      <Container className="py-14 lg:py-20">
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {imageCredits.map((credit) => (
            <li key={credit.file} className="overflow-hidden rounded-card ring-1 ring-line">
              <div className="relative aspect-[3/2] bg-surface">
                <Image
                  src={`/images/${credit.file}`}
                  alt={credit.alt}
                  fill
                  quality={70}
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  className="object-cover"
                />
              </div>
              <div className="p-5 text-sm">
                <p className="font-semibold text-ink">{credit.subject}</p>
                <p className="mt-2 text-ink-muted">
                  By {credit.author} ·{' '}
                  {credit.licenseUrl ? (
                    <a
                      href={credit.licenseUrl}
                      className="underline underline-offset-2 hover:text-ink"
                      rel="license noreferrer"
                    >
                      {credit.license}
                    </a>
                  ) : (
                    credit.license
                  )}
                </p>
                <a
                  href={credit.sourceUrl}
                  className="mt-2 inline-block font-semibold text-navy-700 underline underline-offset-2"
                  rel="noreferrer"
                >
                  View source<span className="sr-only"> for {credit.subject}</span>
                </a>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </>
  );
}
