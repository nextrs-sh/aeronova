import { passengerNoun, type OfferPrice } from '@velasia/contracts';
import { formatMinor } from '@/lib/format';

const PASSENGER_TYPE = { adult: 'adults', child: 'children', infant: 'infants' } as const;

/**
 * An offer's price, itemised per passenger type: base fare, the fare family's part, each
 * mandatory tax and fee, and included services (which cost nothing extra). Hook-free, so it
 * renders on either side of the client boundary.
 */
export function OfferPriceBreakdown({
  price,
  familyName,
  title,
}: {
  price: OfferPrice;
  familyName: string;
  title?: string;
}) {
  const money = (amount: number) => formatMinor(amount, price.currency);
  return (
    <div>
      {title ? <h4 className="mb-2 font-semibold text-ink">{title}</h4> : null}
      <ul className="space-y-3 text-sm">
        {price.passengers.map((line) => (
          <li key={line.passengerType} className="rounded-xl bg-surface p-3">
            <p className="flex justify-between gap-4 font-semibold text-ink">
              <span>
                {line.count} {passengerNoun(PASSENGER_TYPE[line.passengerType], line.count)}
              </span>
              <span className="tabular-nums">{money(line.subtotalMinor)}</span>
            </p>
            <dl className="mt-1.5 space-y-1 text-ink-muted">
              <Row label={`Flight base fare${line.count > 1 ? ', each' : ''}`}>
                {money(line.baseFareMinor)}
              </Row>
              {line.fareFamilyMinor > 0 ? (
                <Row label={`${familyName} fare benefits`}>{money(line.fareFamilyMinor)}</Row>
              ) : null}
              {line.taxes.map((tax) => (
                <Row key={tax.label} label={tax.label}>
                  {money(tax.amountMinor)}
                </Row>
              ))}
              {line.taxes.length === 0 ? <Row label="Taxes and fees">None (lap infant)</Row> : null}
              <Row label="Included services">No extra charge</Row>
            </dl>
          </li>
        ))}
      </ul>
      <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
        <Row label="Base fares">{money(price.totals.baseFareMinor)}</Row>
        <Row label={`${familyName} fare benefits`}>{money(price.totals.fareFamilyMinor)}</Row>
        <Row label="Taxes and fees">{money(price.totals.taxesMinor)}</Row>
        <div className="flex justify-between gap-4 pt-1 font-semibold text-ink">
          <dt>Total, all travellers</dt>
          <dd className="tabular-nums">{money(price.totalMinor)}</dd>
        </div>
      </dl>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt>{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}
