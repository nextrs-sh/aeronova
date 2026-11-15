'use client';

import type {
  PaymentMethod,
  PaymentOptions,
  ServicingQuote,
  SimulatedOutcome,
} from '@velasia/contracts';
import { Button } from '@velasia/ui/button';
import { cn } from '@velasia/ui/cn';
import { AlertTriangle, Check, FlaskConical, Hourglass, Loader2, Lock } from 'lucide-react';
import { useActionState, useState, type ReactNode } from 'react';
import { useHydrated } from '@/hooks/use-hydrated';
import { formatMinor } from '@/lib/format';
import { MANAGE_IDLE, type ManageActionState } from './action-state';

/*
 * Confirm a servicing quote (Milestone 6): the traveller sees the price the API computed, picks a
 * demo payment method when there is something to pay, and confirms explicitly. The form sends
 * only what the traveller agreed to (`accepted`) and the revision they saw; the API re-prices and
 * refuses anything different. The idempotency key is rendered with the page, so a double click
 * resends the same request.
 */

type Action = (state: ManageActionState, formData: FormData) => Promise<ManageActionState>;

export function ActionResult({ state }: { state: ManageActionState }) {
  if (state.status === 'error') {
    return (
      <p
        role="alert"
        className="mt-3 flex gap-2 rounded-xl bg-danger-surface p-3 text-sm text-danger"
        data-testid="action-error"
        data-code={state.code}
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {state.message}
      </p>
    );
  }
  if (state.status === 'pending') {
    return (
      <p
        role="status"
        className="mt-3 flex gap-2 rounded-xl bg-gold-50 p-3 text-sm text-gold-900"
        data-testid="action-pending"
      >
        <Hourglass className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {state.message}
      </p>
    );
  }
  if (state.status === 'done') {
    return (
      <p role="status" className="mt-3 flex gap-2 text-sm text-success" data-testid="action-done">
        <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {state.message}
      </p>
    );
  }
  return null;
}

export function DemoPaymentFields({
  options,
  name = 'outcome',
}: {
  options: PaymentOptions;
  name?: string;
}) {
  const [method, setMethod] = useState<PaymentMethod>('DEMO_CARD');
  const [outcome, setOutcome] = useState<SimulatedOutcome>('SUCCESS');
  return (
    <>
      <fieldset>
        <legend className="text-sm font-bold text-ink">Demo payment method</legend>
        <div className="mt-2 grid gap-2">
          {options.methods.map((option) => {
            const checked = method === option.code;
            return (
              <label
                key={option.code}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-2xl border p-3 text-sm font-semibold text-ink transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus',
                  checked
                    ? 'border-primary bg-primary-subtle ring-1 ring-primary'
                    : 'border-line bg-white hover:border-navy-300',
                )}
              >
                <input
                  type="radio"
                  name="method"
                  value={option.code}
                  checked={checked}
                  onChange={() => setMethod(option.code)}
                  className="size-4 accent-primary"
                />
                {option.name}
              </label>
            );
          })}
        </div>
      </fieldset>
      {options.outcomeControls ? (
        <OutcomeFields options={options} name={name} value={outcome} onChange={setOutcome} />
      ) : null}
    </>
  );
}

function OutcomeFields({
  options,
  name,
  value,
  onChange,
  label = 'Simulated payment outcome (demo and testing only)',
}: {
  options: PaymentOptions;
  name: string;
  value: SimulatedOutcome;
  onChange: (value: SimulatedOutcome) => void;
  label?: string;
}) {
  return (
    <fieldset className="mt-4 rounded-2xl border border-dashed border-gold-300 bg-gold-50 p-4">
      <legend className="flex items-center gap-2 px-1 text-sm font-bold text-gold-900">
        <FlaskConical className="size-4" aria-hidden="true" />
        {label}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.outcomes.map((option) => (
          <label key={option.code} className="flex cursor-pointer gap-2 text-sm text-ink">
            <input
              type="radio"
              name={name}
              value={option.code}
              checked={value === option.code}
              onChange={() => onChange(option.code)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="font-semibold">{option.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function RefundOutcomeFields({ options }: { options: PaymentOptions }) {
  const [value, setValue] = useState<SimulatedOutcome>('SUCCESS');
  if (!options.outcomeControls) return null;
  return (
    <OutcomeFields
      options={options}
      name="refundOutcome"
      value={value}
      onChange={setValue}
      label="Simulated refund outcome (demo and testing only)"
    />
  );
}

export function SubmitButton({
  pending,
  children,
  testId,
  variant = 'primary',
}: {
  pending: boolean;
  children: ReactNode;
  testId: string;
  variant?: 'primary' | 'secondary' | 'outline';
}) {
  return (
    <Button
      type="submit"
      size="lg"
      variant={variant}
      className="mt-5 w-full"
      aria-disabled={pending || undefined}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
      data-testid={testId}
    >
      {pending ? (
        <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : null}
      {pending ? 'Working on it…' : children}
    </Button>
  );
}

export function ServicingConfirm({
  action,
  quote,
  orderId,
  revision,
  hidden,
  options,
  idempotencyKey,
  label,
  children,
}: {
  action: Action;
  quote: ServicingQuote;
  orderId: string;
  revision: number;
  /** What is being confirmed (direction, itinerary, seat, service…). */
  hidden: Record<string, string>;
  options: PaymentOptions | null;
  idempotencyKey: string;
  /** The confirm button's words when nothing is paid. */
  label: string;
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, MANAGE_IDLE);
  const hydrated = useHydrated();
  const { kind, amountMinor } = quote.adjustment;
  const amount = formatMinor(amountMinor, quote.currency);
  return (
    <form action={formAction} data-testid="servicing-confirm" data-ready={hydrated || undefined}>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="accepted" value={quote.netMinor} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      {kind === 'CHARGE' && options ? (
        <div className="mt-5">
          <DemoPaymentFields options={options} />
        </div>
      ) : null}
      {kind === 'REFUND' && options ? <RefundOutcomeFields options={options} /> : null}
      <p className="mt-4 flex gap-2 rounded-2xl bg-surface p-3 text-xs text-ink-muted">
        <Lock className="mt-0.5 size-4 shrink-0 text-navy-600" aria-hidden="true" />
        Simulated: no card, bank, or wallet details are used, and no money moves. Your current
        booking stays exactly as it is unless this change is completed.
      </p>
      <SubmitButton pending={pending} testId="confirm-servicing">
        {kind === 'CHARGE'
          ? `Confirm and pay ${amount} (demo)`
          : kind === 'REFUND'
            ? `${label} · ${amount} refund`
            : label}
      </SubmitButton>
      <div aria-live="polite">
        <ActionResult state={state} />
      </div>
    </form>
  );
}

/** A one-button form (check status, discard, retry a refund) with its own result. */
export function SmallActionForm({
  action,
  fields,
  label,
  testId,
  variant = 'outline',
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  testId: string;
  variant?: 'primary' | 'secondary' | 'outline';
}) {
  const [state, formAction, pending] = useActionState(action, MANAGE_IDLE);
  return (
    <form action={formAction} className="min-w-0">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button
        type="submit"
        variant={variant}
        aria-disabled={pending || undefined}
        onClick={(event) => {
          if (pending) event.preventDefault();
        }}
        data-testid={testId}
      >
        {pending ? (
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : null}
        {label}
      </Button>
      <div aria-live="polite">
        <ActionResult state={state} />
      </div>
    </form>
  );
}

/** Pay again for a change whose payment was declined. */
export function PayAgainForm({
  action,
  orderId,
  operationId,
  amountMinor,
  currency,
  options,
  idempotencyKey,
}: {
  action: Action;
  orderId: string;
  operationId: string;
  amountMinor: number;
  currency: string;
  options: PaymentOptions;
  idempotencyKey: string;
}) {
  const [state, formAction, pending] = useActionState(action, MANAGE_IDLE);
  return (
    <form action={formAction} data-testid="pay-again">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="operationId" value={operationId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <DemoPaymentFields options={options} />
      <SubmitButton pending={pending} testId="pay-again-button">
        Try again · pay {formatMinor(amountMinor, currency)} (demo)
      </SubmitButton>
      <div aria-live="polite">
        <ActionResult state={state} />
      </div>
    </form>
  );
}
