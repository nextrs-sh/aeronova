'use client';

import type { Order, OrderAncillaries, PaymentOptions } from '@velasia/contracts';
import { slotLabel } from '@velasia/contracts';
import { Button } from '@velasia/ui/button';
import { cn } from '@velasia/ui/cn';
import { Check, Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { formatMinor } from '@/lib/format';
import { MANAGE_IDLE, type ManageActionState } from './action-state';
import { purchaseAncillaryAction, quoteAncillaryAction } from './actions';
import { QuoteLines } from './parts';
import { ActionResult, ServicingConfirm } from './servicing-confirm';

type Offer = OrderAncillaries['offers'][number];

const CATEGORY = { BAGGAGE: 'Extra baggage', MEAL: 'Meal', PRIORITY: 'Priority' } as const;
const key = (offer: Offer) =>
  `${offer.category}|${offer.travellerId}|${offer.direction}|${offer.flightId ?? ''}|${offer.productId}`;

/*
 * Add a service after booking (Milestone 6). The offers, prices, and what is already owned come
 * from the API (the M4 catalogue and rules); choosing one asks the API for a quote, and the
 * traveller confirms it explicitly. Nothing is marked as bought until the API completes it.
 */
export function ExtrasPicker({
  order,
  ancillaries,
  products,
  flights,
  options,
  idempotencyKey,
}: {
  order: Order;
  ancillaries: OrderAncillaries;
  /** Product names by id, from the public catalogue. */
  products: Record<string, string>;
  /** Flight labels by flight id. */
  flights: Record<string, string>;
  options: PaymentOptions | null;
  idempotencyKey: string;
}) {
  const [selected, setSelected] = useState<Offer | null>(null);
  const [quote, setQuote] = useState<ManageActionState>(MANAGE_IDLE);
  const [pending, start] = useTransition();
  const name = (id: string) => {
    const traveller = order.passengers.find((p) => p.id === id);
    return traveller ? `${traveller.givenName} ${traveller.familyName}` : slotLabel(id);
  };

  function choose(offer: Offer) {
    setSelected(offer);
    setQuote(MANAGE_IDLE);
    const form = new FormData();
    form.set('orderId', order.id);
    form.set('category', offer.category);
    form.set('travellerId', offer.travellerId);
    form.set('direction', offer.direction);
    if (offer.flightId) form.set('flightId', offer.flightId);
    form.set('productId', offer.productId);
    start(async () => setQuote(await quoteAncillaryAction(MANAGE_IDLE, form)));
  }

  const groups = new Map<string, Offer[]>();
  for (const offer of ancillaries.offers) {
    const where = offer.flightId
      ? (flights[offer.flightId] ?? offer.flightId)
      : offer.direction === 'outbound'
        ? 'Departing trip'
        : 'Return trip';
    const label = `${name(offer.travellerId)} · ${CATEGORY[offer.category]} · ${where}`;
    groups.set(label, [...(groups.get(label) ?? []), offer]);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-4" data-testid="extras-picker">
        {[...groups].map(([label, offers]) => (
          <fieldset
            key={label}
            className="rounded-[1.25rem] border border-line bg-white p-4 shadow-card"
          >
            <legend className="px-1 text-sm font-bold text-ink">{label}</legend>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {offers.map((offer) => {
                const active = selected && key(selected) === key(offer);
                const disabled = Boolean(offer.unavailableReason);
                return (
                  <li key={key(offer)}>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-pressed={Boolean(active)}
                      onClick={() => choose(offer)}
                      className={cn(
                        'flex w-full items-start justify-between gap-3 rounded-2xl border p-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed',
                        active
                          ? 'border-primary bg-primary-subtle ring-1 ring-primary'
                          : 'border-line bg-white hover:border-navy-300',
                        disabled && 'bg-surface text-ink-subtle',
                      )}
                      data-testid={`extra-${offer.productId}-${offer.travellerId}-${offer.flightId ?? offer.direction}`}
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold text-ink">
                          {products[offer.productId] ?? offer.productId}
                        </span>
                        <span className="block text-xs text-ink-muted">
                          {offer.owned ? (
                            <span className="inline-flex items-center gap-1 text-success">
                              <Check className="size-3" aria-hidden="true" />
                              In your booking
                            </span>
                          ) : (
                            (offer.unavailableReason ??
                            (offer.payableMinor < offer.priceMinor
                              ? 'Upgrade: you pay the difference'
                              : ' '))
                          )}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {offer.included
                          ? 'Included'
                          : formatMinor(
                              offer.owned ? offer.priceMinor : offer.payableMinor,
                              ancillaries.currency,
                            )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))}
      </div>
      <aside
        className="lg:sticky lg:top-24 lg:self-start"
        aria-live="polite"
        data-testid="extras-panel"
      >
        <div className="rounded-[1.5rem] border border-line bg-white p-5 shadow-card">
          {!selected ? (
            <p className="text-sm text-ink-muted">
              Choose a service to see its price. Bags and priority can be added until{' '}
              {ancillaries.cutoffs.baggageHours} hours before departure, meals until{' '}
              {ancillaries.cutoffs.mealHours} hours before. Anything your fare already includes is
              never charged.
            </p>
          ) : pending || quote.status === 'idle' ? (
            <p className="flex items-center gap-2 text-sm text-ink-muted" role="status">
              <Loader2
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              Pricing…
            </p>
          ) : quote.status === 'quoted' ? (
            <>
              <QuoteLines quote={quote.quote} title="Price of this service" />
              <ServicingConfirm
                key={key(selected)}
                action={purchaseAncillaryAction}
                quote={quote.quote}
                orderId={order.id}
                revision={order.revision}
                hidden={{
                  category: selected.category,
                  travellerId: selected.travellerId,
                  direction: selected.direction,
                  ...(selected.flightId ? { flightId: selected.flightId } : {}),
                  productId: selected.productId,
                }}
                options={options}
                idempotencyKey={idempotencyKey}
                label="Add to my booking"
              />
            </>
          ) : (
            <>
              <ActionResult state={quote} />
              <Button
                type="button"
                variant="ghost"
                className="mt-2"
                onClick={() => setSelected(null)}
              >
                Choose something else
              </Button>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
