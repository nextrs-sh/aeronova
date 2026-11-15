import {
  CABIN_LABELS,
  SERVICE_ROWS,
  serviceFor,
  type CabinClass,
  type FareFamilyCode,
  type JourneyDirection,
  type Offer,
  type ServiceCode,
} from '@velasia/contracts';
import { Badge } from '@velasia/ui/badge';
import { cn } from '@velasia/ui/cn';
import { Ban, Check } from 'lucide-react';
import { formatMinor, formatMinorDifference } from '@/lib/format';
import { OfferPriceBreakdown } from './offer-price-breakdown';
import { SelectFareForm } from './select-fare-form';
import { ServiceValue } from './service-value';

/** The rows a card shows up front; the comparison table has every row. */
const HIGHLIGHTS: readonly ServiceCode[] = [
  'CABIN_BAGGAGE',
  'CHECKED_BAGGAGE',
  'STANDARD_SEAT',
  'FLIGHT_CHANGE',
  'REFUND',
];
const LABEL = new Map(SERVICE_ROWS.map((row) => [row.code, row.label]));

export interface FareCardFamily {
  code: FareFamilyCode;
  name: string;
  shortName: string;
  tagline: string;
  cabin: CabinClass;
}

interface FareCardProps {
  family: FareCardFamily;
  /** The offer for this family, or `null` when the family isn't offered here. */
  offer: Offer | null;
  unavailableMessage?: string;
  /** The traveller's current choice for this flight, to show the difference. */
  current: { family: FareFamilyCode; name: string; totalMinor: number } | null;
  form: { query: string; direction: JourneyDirection };
  /** e.g. `2 adults, 1 child`, when more than one person travels. */
  party: string | null;
}

/** One fare family for one flight: price for everyone, what it includes, and how to choose it. */
export function FareCard({
  family,
  offer,
  unavailableMessage,
  current,
  form,
  party,
}: FareCardProps) {
  const headingId = `fare-${family.code}`;
  const isCurrent = offer !== null && current?.family === family.code;
  const difference =
    offer && current && !isCurrent ? offer.price.totalMinor - current.totalMinor : null;
  return (
    <article
      aria-labelledby={headingId}
      data-testid="fare-card"
      data-family={family.code}
      className={cn(
        'flex flex-col rounded-[1.5rem] border p-5',
        offer ? 'bg-white shadow-card' : 'border-dashed border-line-strong bg-surface',
        isCurrent ? 'border-primary ring-2 ring-primary' : offer && 'border-line',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-[0.14em] text-primary uppercase">
            {CABIN_LABELS[family.cabin]}
          </p>
          <h3 id={headingId} className="mt-1 font-display text-xl font-bold text-ink">
            {family.name}
          </h3>
        </div>
        {isCurrent ? (
          <Badge tone="primary" className="shrink-0">
            <Check aria-hidden="true" />
            Your choice
          </Badge>
        ) : null}
      </div>
      <p className="mt-1.5 text-sm text-ink-muted">{family.tagline}</p>

      {offer ? (
        <div className="mt-4">
          <p
            className="font-display text-3xl leading-none font-extrabold text-ink tabular-nums"
            data-testid="fare-total"
          >
            {formatMinor(offer.price.totalMinor, offer.price.currency)}
          </p>
          <p className="mt-1.5 text-xs text-ink-muted">
            {party
              ? `Total for ${party} · ${formatMinor(offer.price.perAdultMinor, offer.price.currency)} per adult`
              : 'Per adult'}{' '}
            · taxes and fees included
          </p>
          {difference !== null ? (
            <p className="mt-1 text-xs font-semibold text-ink" data-testid="fare-difference">
              {formatMinorDifference(difference, offer.price.currency)} compared with{' '}
              {current!.name}
            </p>
          ) : null}
        </div>
      ) : (
        <p
          className="mt-4 flex gap-2 text-sm font-medium text-ink-muted"
          data-testid="fare-unavailable"
        >
          <Ban className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {unavailableMessage ?? 'Not available on this flight.'}
        </p>
      )}

      {offer ? (
        <>
          <ul
            className="mt-5 grid flex-1 grid-cols-2 content-start gap-x-4 gap-y-2.5 text-sm md:grid-cols-1"
            aria-label={`${family.shortName} includes`}
          >
            {HIGHLIGHTS.map((code) => (
              <li key={code}>
                <span className="mb-0.5 block text-xs text-ink-muted">{LABEL.get(code)}</span>
                <ServiceValue service={serviceFor(offer.services, code)} />
              </li>
            ))}
          </ul>
          <details className="group mt-5 rounded-xl border border-line">
            <summary className="cursor-pointer list-none rounded-xl px-3 py-2 text-sm font-semibold text-primary hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
              Price breakdown<span className="sr-only"> for {family.name}</span>
            </summary>
            <div className="border-t border-line p-3">
              <OfferPriceBreakdown price={offer.price} familyName={family.shortName} />
            </div>
          </details>
          <SelectFareForm
            className="mt-4"
            query={form.query}
            direction={form.direction}
            offerId={offer.id}
            label={isCurrent ? `Continue with ${family.shortName}` : `Select ${family.shortName}`}
            description={`for ${formatMinor(offer.price.totalMinor, offer.price.currency)}`}
          />
        </>
      ) : null}
    </article>
  );
}
