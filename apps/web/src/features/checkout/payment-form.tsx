'use client';

import type { PaymentMethod, PaymentOptions, SimulatedOutcome } from '@velasia/contracts';
import { Button } from '@velasia/ui/button';
import { cn } from '@velasia/ui/cn';
import {
  AlertTriangle,
  Building2,
  CreditCard,
  FlaskConical,
  Hourglass,
  Loader2,
  Lock,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useHydrated } from '@/hooks/use-hydrated';
import { formatMinor } from '@/lib/format';
import { CHECKOUT_IDLE, type CheckoutActionState } from './action-state';
import { refreshPaymentStatusAction, retryPaymentAction, submitDemoPaymentAction } from './actions';

const METHOD_ICONS: Record<PaymentMethod, typeof CreditCard> = {
  DEMO_CARD: CreditCard,
  DEMO_WALLET: Wallet,
  DEMO_BANK_TRANSFER: Building2,
};

function Result({ state }: { state: CheckoutActionState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status !== 'idle') ref.current?.focus();
  }, [state]);
  if (state.status === 'idle' || state.status === 'checked') return null;
  const content =
    state.status === 'declined'
      ? {
          title: 'Payment unsuccessful',
          body: `${state.message} ${
            state.attemptsRemaining > 0
              ? `Your seats are still held — you can try again (${state.attemptsRemaining} ${state.attemptsRemaining === 1 ? 'attempt' : 'attempts'} left).`
              : ''
          }`,
          tone: 'danger' as const,
          testId: 'payment-declined',
        }
      : state.status === 'pending'
        ? {
            title: 'Payment pending',
            body: 'The demo provider hasn’t decided yet. Your booking isn’t confirmed until it does — check the status in a few seconds.',
            tone: 'info' as const,
            testId: 'payment-pending',
          }
        : {
            title: state.code === 'uncertain' ? 'We’re not sure yet' : 'Payment not completed',
            body: state.message,
            tone: state.code === 'uncertain' ? ('info' as const) : ('danger' as const),
            testId: `payment-error-${state.code}`,
          };
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={content.tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'mt-4 flex gap-3 rounded-2xl p-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-navy-500',
        content.tone === 'danger' ? 'bg-danger-surface text-danger' : 'bg-navy-50 text-ink',
      )}
      data-testid={content.testId}
    >
      {content.tone === 'danger' ? (
        <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      ) : (
        <Hourglass className="mt-0.5 size-5 shrink-0 text-navy-600" aria-hidden="true" />
      )}
      <div>
        <p className="font-semibold">{content.title}</p>
        <p className="mt-0.5">{content.body}</p>
      </div>
    </div>
  );
}

/**
 * The simulated payment. No card, bank, or wallet details exist anywhere in this form. The
 * tester may pick the simulated outcome where the API allows it; the API decides the result
 * and charges the order's own total — the browser sends no amount.
 */
export function PaymentForm({
  orderId,
  totalMinor,
  currency,
  options,
  retry,
  idempotencyKey,
}: {
  orderId: string;
  totalMinor: number;
  currency: string;
  options: PaymentOptions;
  /** The last attempt was declined: this is another try. */
  retry: boolean;
  /**
   * Rendered by the server with each page render: a double click resends it, and the refresh
   * after a decline brings a new one. The API refuses a second attempt while one is undecided.
   */
  idempotencyKey: string;
}) {
  const [state, formAction, pending] = useActionState(
    retry ? retryPaymentAction : submitDemoPaymentAction,
    CHECKOUT_IDLE,
  );
  const [method, setMethod] = useState<PaymentMethod>('DEMO_CARD');
  const [outcome, setOutcome] = useState<SimulatedOutcome>('SUCCESS');
  const hydrated = useHydrated();

  const total = formatMinor(totalMinor, currency);
  return (
    <form action={formAction} data-ready={hydrated || undefined} data-testid="payment-form">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <fieldset>
        <legend className="text-sm font-bold text-ink">Demo payment method</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {options.methods.map((option) => {
            const Icon = METHOD_ICONS[option.code];
            const checked = method === option.code;
            return (
              <label
                key={option.code}
                className={cn(
                  'flex cursor-pointer flex-col gap-1 rounded-2xl border p-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-navy-500',
                  checked
                    ? 'border-navy-700 bg-navy-50'
                    : 'border-line bg-white hover:border-navy-300',
                )}
              >
                <span className="flex items-center gap-2 font-semibold text-ink">
                  <input
                    type="radio"
                    name="method"
                    value={option.code}
                    checked={checked}
                    onChange={() => setMethod(option.code)}
                    className="size-4 accent-navy-800"
                  />
                  <Icon className="size-4 text-navy-700" aria-hidden="true" />
                  {option.name}
                </span>
                <span className="text-xs text-ink-muted">{option.description}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {options.outcomeControls ? (
        <fieldset className="mt-5 rounded-2xl border border-dashed border-gold-300 bg-gold-50 p-4">
          <legend className="flex items-center gap-2 px-1 text-sm font-bold text-gold-900">
            <FlaskConical className="size-4" aria-hidden="true" />
            Simulated outcome (demo and testing only)
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {options.outcomes.map((option) => (
              <label key={option.code} className="flex cursor-pointer gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="outcome"
                  value={option.code}
                  checked={outcome === option.code}
                  onChange={() => setOutcome(option.code)}
                  className="mt-0.5 size-4 accent-navy-800"
                />
                <span>
                  <span className="font-semibold">{option.name}</span>
                  <span className="block text-xs text-ink-muted">{option.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <p className="mt-5 flex gap-2 rounded-2xl bg-surface p-3 text-xs text-ink-muted">
        <Lock className="mt-0.5 size-4 shrink-0 text-navy-600" aria-hidden="true" />
        {options.disclaimer}
      </p>

      <Button
        type="submit"
        size="lg"
        className="mt-5 w-full"
        aria-disabled={pending || undefined}
        onClick={(event) => {
          if (pending) event.preventDefault();
        }}
        data-testid="pay-button"
      >
        {pending ? (
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : null}
        {pending
          ? 'Processing your demo payment…'
          : retry
            ? `Try again · pay ${total} (demo)`
            : `Pay ${total} (demo)`}
      </Button>
      <div aria-live="polite">
        <Result state={state} />
      </div>
    </form>
  );
}

/** Ask the provider what happened. Never pays again. */
export function PaymentStatusCheck({
  orderId,
  autoFocus = false,
}: {
  orderId: string;
  /** Take focus when shown in place of the payment form, so keyboard users aren't lost. */
  autoFocus?: boolean;
}) {
  const [state, formAction, pending] = useActionState(refreshPaymentStatusAction, CHECKOUT_IDLE);
  const hydrated = useHydrated();
  return (
    <form action={formAction} data-ready={hydrated || undefined}>
      <input type="hidden" name="orderId" value={orderId} />
      <Button
        type="submit"
        aria-disabled={pending || undefined}
        onClick={(event) => {
          if (pending) event.preventDefault();
        }}
        autoFocus={autoFocus}
        data-testid="check-payment-status"
      >
        {pending ? (
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <RefreshCw aria-hidden="true" />
        )}
        {pending ? 'Checking…' : 'Check payment status'}
      </Button>
      <div aria-live="polite">
        <Result state={state} />
      </div>
    </form>
  );
}
