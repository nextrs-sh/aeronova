'use client';

import type { PaymentOptions } from '@velasia/contracts';
import { useActionState } from 'react';
import { useHydrated } from '@/hooks/use-hydrated';
import { formatMinor } from '@/lib/format';
import { MANAGE_IDLE } from './action-state';
import { confirmCancellationAction } from './actions';
import { ActionResult, RefundOutcomeFields, SubmitButton } from './servicing-confirm';

/** Cancel the booking: an explicit tick, then one clearly worded button. No urgency, no tricks. */
export function CancelForm({
  orderId,
  revision,
  refundMinor,
  currency,
  options,
  idempotencyKey,
}: {
  orderId: string;
  revision: number;
  refundMinor: number;
  currency: string;
  options: PaymentOptions | null;
  idempotencyKey: string;
}) {
  const [state, formAction, pending] = useActionState(confirmCancellationAction, MANAGE_IDLE);
  const hydrated = useHydrated();
  const fieldError = state.status === 'error' ? state.fields?.confirm : undefined;
  return (
    <form action={formAction} data-testid="cancel-form" data-ready={hydrated || undefined}>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="accepted" value={-refundMinor} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <label className="flex gap-3 rounded-2xl border border-line p-4 text-sm text-ink">
        <input
          type="checkbox"
          name="confirm"
          value="yes"
          className="mt-0.5 size-4 accent-primary"
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? 'confirm-error' : undefined}
          data-testid="cancel-confirm-checkbox"
        />
        <span>
          I want to cancel this booking for every traveller. I understand the seats are released and
          the booking can’t be restored.
        </span>
      </label>
      {fieldError ? (
        <p id="confirm-error" className="mt-2 text-sm text-danger">
          {fieldError}
        </p>
      ) : null}
      {refundMinor > 0 && options ? <RefundOutcomeFields options={options} /> : null}
      <SubmitButton pending={pending} testId="confirm-cancellation" variant="secondary">
        {refundMinor > 0
          ? `Cancel booking · ${formatMinor(refundMinor, currency)} refund`
          : 'Cancel booking · no refund'}
      </SubmitButton>
      <div aria-live="polite">
        <ActionResult state={state} />
      </div>
    </form>
  );
}
