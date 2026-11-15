'use client';

import type { OrderSeatMap, PaymentOptions, SeatAssignment } from '@velasia/contracts';
import { Button } from '@velasia/ui/button';
import { Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { SeatSelector, type SeatSegment } from '@/features/booking/seat-selector';
import type { ManageActionState } from './action-state';
import { confirmSeatChangeAction, quoteSeatChangeAction } from './actions';
import { QuoteLines } from './parts';
import { ActionResult, ServicingConfirm } from './servicing-confirm';

/*
 * Change a seat after booking (Milestone 6), with the M4 seat selector in "propose" mode:
 * choosing a seat asks the API for the price of the change (what is already paid for this
 * traveller's seat counts towards the new one), and nothing changes until the traveller
 * confirms — and pays, when the new seat costs more.
 */
export function SeatChangeFlow({
  orderId,
  revision,
  segment,
  map,
  assignments,
  options,
  idempotencyKey,
}: {
  orderId: string;
  revision: number;
  segment: SeatSegment;
  map: OrderSeatMap;
  assignments: SeatAssignment[];
  options: PaymentOptions | null;
  idempotencyKey: string;
}) {
  const [proposal, setProposal] = useState<{
    travellerId: string;
    flightId: string;
    seatId: string;
  } | null>(null);
  const [quote, setQuote] = useState<ManageActionState>({ status: 'idle' });
  const [pending, start] = useTransition();

  function propose(next: { travellerId: string; flightId: string; seatId: string }) {
    setProposal(next);
    setQuote({ status: 'idle' });
    start(async () => setQuote(await quoteSeatChangeAction({ orderId, ...next })));
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <SeatSelector
        segments={[segment]}
        initialMap={map}
        assignments={assignments}
        onPropose={propose}
        proposedSeatId={proposal?.seatId ?? null}
      />
      <aside
        className="xl:sticky xl:top-24 xl:self-start"
        aria-live="polite"
        data-testid="seat-change-panel"
      >
        <div className="rounded-[1.5rem] border border-line bg-white p-5 shadow-card">
          {!proposal ? (
            <p className="text-sm text-ink-muted">
              Choose a traveller, then a seat. We’ll show you the price of the change before
              anything changes. What you already paid for a seat counts towards the new one; a
              cheaper seat isn’t refunded.
            </p>
          ) : pending || quote.status === 'idle' ? (
            <p className="flex items-center gap-2 text-sm text-ink-muted" role="status">
              <Loader2
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              Pricing seat {proposal.seatId}…
            </p>
          ) : quote.status === 'quoted' ? (
            <>
              <QuoteLines quote={quote.quote} title={`Change to seat ${proposal.seatId}`} />
              <ServicingConfirm
                key={`${proposal.travellerId}-${proposal.seatId}`}
                action={confirmSeatChangeAction}
                quote={quote.quote}
                orderId={orderId}
                revision={revision}
                hidden={proposal}
                options={options}
                idempotencyKey={idempotencyKey}
                label="Confirm seat change"
              />
              <Button
                type="button"
                variant="ghost"
                className="mt-2 w-full"
                onClick={() => setProposal(null)}
              >
                Choose a different seat
              </Button>
            </>
          ) : (
            <>
              <ActionResult state={quote} />
              <Button
                type="button"
                variant="ghost"
                className="mt-2"
                onClick={() => setProposal(null)}
              >
                Choose another seat
              </Button>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
