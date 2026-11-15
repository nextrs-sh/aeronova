'use client';

import { Button } from '@velasia/ui/button';
import { AlertTriangle, ArrowRight, Loader2, RotateCw } from 'lucide-react';
import { useActionState, useEffect, useRef } from 'react';
import { useHydrated } from '@/hooks/use-hydrated';
import { CHECKOUT_IDLE } from './action-state';
import { prepareCheckoutAction, validateCheckoutAction } from './actions';

/**
 * "Continue to checkout": the API re-checks everything and holds the seats. The idempotency key
 * comes with each server render: a double click sends the same key (no second hold), and a
 * changed price or trip re-renders the page with a new one. Even under a new key the API returns
 * the session's existing pending order for the same request, so nothing is held twice.
 */
export function CheckoutStartForm({
  version,
  totalMinor,
  idempotencyKey,
  holdMinutes = 10,
  label = 'Continue to checkout',
}: {
  version: number;
  totalMinor: number;
  idempotencyKey: string;
  holdMinutes?: number;
  label?: string;
}) {
  const [state, formAction, pending] = useActionState(prepareCheckoutAction, CHECKOUT_IDLE);
  const hydrated = useHydrated();
  const message = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state.status === 'error') message.current?.focus();
  }, [state]);

  return (
    <form action={formAction} className="w-full sm:w-auto" data-ready={hydrated || undefined}>
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="total" value={totalMinor} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Button
        type="submit"
        size="lg"
        className="w-full sm:w-auto"
        aria-disabled={pending || undefined}
        onClick={(event) => {
          if (pending) event.preventDefault();
        }}
        data-testid="continue-checkout"
      >
        {pending ? (
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : null}
        {pending ? 'Checking and holding your seats…' : label}
        {pending ? null : <ArrowRight aria-hidden="true" />}
      </Button>
      <p className="mt-2 text-xs text-ink-muted sm:text-right">
        We check prices and seats once more, then hold your seats for {holdMinutes} minutes while
        you pay.
      </p>
      <div aria-live="polite">
        {state.status === 'error' ? (
          <p
            ref={message}
            tabIndex={-1}
            role="alert"
            className="mt-3 flex gap-2 rounded-xl bg-danger-surface p-3 text-sm text-danger sm:max-w-md"
            data-testid="checkout-start-error"
            data-code={state.code}
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

/** Re-check prices and availability (after a hold ended), without holding anything yet. */
export function CheckoutRecheckForm() {
  const [state, formAction, pending] = useActionState(validateCheckoutAction, CHECKOUT_IDLE);
  return (
    <form action={formAction}>
      <Button
        type="submit"
        variant="secondary"
        aria-disabled={pending || undefined}
        onClick={(event) => {
          if (pending) event.preventDefault();
        }}
        data-testid="checkout-recheck"
      >
        {pending ? (
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <RotateCw aria-hidden="true" />
        )}
        {pending ? 'Checking…' : 'Check prices and seats again'}
      </Button>
      <div aria-live="polite">
        {state.status === 'error' ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
