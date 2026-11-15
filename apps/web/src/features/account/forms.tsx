'use client';

import {
  ACCOUNT_RULES,
  COUNTRIES,
  TRAVELLER_TITLES,
  type SavedTraveller,
  type TripSummary,
} from '@velasia/contracts';
import { Button } from '@velasia/ui/button';
import { Loader2 } from 'lucide-react';
import { useActionState, type ReactNode } from 'react';
import { useHydrated } from '@/hooks/use-hydrated';
import { MANAGE_IDLE, type ManageActionState } from '@/features/manage/action-state';
import { ActionResult } from '@/features/manage/servicing-confirm';
import {
  changePasswordAction,
  deleteTravellerAction,
  linkBookingsAction,
  registerDemoAccountAction,
  saveTravellerAction,
  signInAction,
  updateProfileAction,
} from './actions';

/*
 * Account forms (Milestone 6). Plain forms posting to Server Actions, so they work before
 * hydration too. Values the traveller typed are never echoed back by the server; field errors
 * are, by name.
 */

const input =
  'mt-1 block h-11 w-full rounded-xl border border-line-strong bg-white px-3 text-ink aria-invalid:border-danger';

function Field({
  name,
  label,
  state,
  hint,
  children,
}: {
  name: string;
  label: string;
  state: ManageActionState;
  hint?: string;
  children: (props: {
    id: string;
    name: string;
    'aria-invalid'?: boolean;
    'aria-describedby'?: string;
  }) => ReactNode;
}) {
  const error = state.status === 'error' ? state.fields?.[name] : undefined;
  const id = `field-${name}`;
  const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {children({
        id,
        name,
        ...(error ? { 'aria-invalid': true } : {}),
        ...(described ? { 'aria-describedby': described } : {}),
      })}
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Submit({
  pending,
  children,
  testId,
}: {
  pending: boolean;
  children: ReactNode;
  testId: string;
}) {
  return (
    <Button
      type="submit"
      size="lg"
      className="w-full"
      aria-disabled={pending || undefined}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
      data-testid={testId}
    >
      {pending ? (
        <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : null}
      {children}
    </Button>
  );
}

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signInAction, MANAGE_IDLE);
  const hydrated = useHydrated();
  return (
    <form
      action={action}
      className="space-y-4"
      data-testid="sign-in-form"
      data-ready={hydrated || undefined}
    >
      <input type="hidden" name="next" value={next} />
      <Field name="email" label="Email" state={state}>
        {(props) => (
          <input {...props} type="email" autoComplete="email" required className={input} />
        )}
      </Field>
      <Field name="password" label="Password" state={state}>
        {(props) => (
          <input
            {...props}
            type="password"
            autoComplete="current-password"
            required
            className={input}
          />
        )}
      </Field>
      <Submit pending={pending} testId="sign-in-submit">
        Sign in
      </Submit>
      <div aria-live="polite">
        <ActionResult state={state} />
      </div>
    </form>
  );
}

export function RegisterForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(registerDemoAccountAction, MANAGE_IDLE);
  const hydrated = useHydrated();
  const demoError = state.status === 'error' ? state.fields?.demo : undefined;
  return (
    <form
      action={action}
      className="space-y-4"
      data-testid="register-form"
      data-ready={hydrated || undefined}
    >
      <input type="hidden" name="next" value={next} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="givenName" label="Given names" state={state}>
          {(props) => <input {...props} autoComplete="given-name" required className={input} />}
        </Field>
        <Field name="familyName" label="Family name" state={state}>
          {(props) => <input {...props} autoComplete="family-name" required className={input} />}
        </Field>
      </div>
      <Field
        name="email"
        label="Email"
        state={state}
        hint="Used to sign in. It isn’t verified and no email is ever sent."
      >
        {(props) => (
          <input {...props} type="email" autoComplete="email" required className={input} />
        )}
      </Field>
      <Field
        name="password"
        label="Password"
        state={state}
        hint={`At least ${ACCOUNT_RULES.passwordMinLength} characters.`}
      >
        {(props) => (
          <input
            {...props}
            type="password"
            autoComplete="new-password"
            minLength={ACCOUNT_RULES.passwordMinLength}
            required
            className={input}
          />
        )}
      </Field>
      <Field name="confirmPassword" label="Confirm password" state={state}>
        {(props) => (
          <input
            {...props}
            type="password"
            autoComplete="new-password"
            required
            className={input}
          />
        )}
      </Field>
      <label className="flex gap-3 rounded-2xl bg-surface p-4 text-sm text-ink">
        <input
          type="checkbox"
          name="demo"
          value="yes"
          className="mt-0.5 size-4 accent-primary"
          aria-invalid={demoError ? true : undefined}
          data-testid="register-demo"
        />
        <span>
          I understand this is a demo account for a fictional airline: there is no email
          verification and no password reset, so I shouldn’t reuse a real password.
        </span>
      </label>
      {demoError ? <p className="text-sm text-danger">{demoError}</p> : null}
      <Submit pending={pending} testId="register-submit">
        Create demo account
      </Submit>
      <div aria-live="polite">
        <ActionResult state={state} />
      </div>
    </form>
  );
}

export function ProfileForm({ givenName, familyName }: { givenName: string; familyName: string }) {
  const [state, action, pending] = useActionState(updateProfileAction, MANAGE_IDLE);
  return (
    <form action={action} className="space-y-4" data-testid="profile-form">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="givenName" label="Given names" state={state}>
          {(props) => (
            <input
              {...props}
              defaultValue={givenName}
              autoComplete="given-name"
              required
              className={input}
            />
          )}
        </Field>
        <Field name="familyName" label="Family name" state={state}>
          {(props) => (
            <input
              {...props}
              defaultValue={familyName}
              autoComplete="family-name"
              required
              className={input}
            />
          )}
        </Field>
      </div>
      <Submit pending={pending} testId="profile-submit">
        Save name
      </Submit>
      <div aria-live="polite">
        <ActionResult state={state} />
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, MANAGE_IDLE);
  return (
    <form action={action} className="space-y-4" data-testid="password-form">
      <Field name="currentPassword" label="Current password" state={state}>
        {(props) => (
          <input
            {...props}
            type="password"
            autoComplete="current-password"
            required
            className={input}
          />
        )}
      </Field>
      <Field
        name="newPassword"
        label="New password"
        state={state}
        hint={`At least ${ACCOUNT_RULES.passwordMinLength} characters. You’ll stay signed in here and be signed out everywhere else.`}
      >
        {(props) => (
          <input
            {...props}
            type="password"
            autoComplete="new-password"
            required
            className={input}
          />
        )}
      </Field>
      <Submit pending={pending} testId="password-submit">
        Change password
      </Submit>
      <div aria-live="polite">
        <ActionResult state={state} />
      </div>
    </form>
  );
}

export function TravellerForm({
  traveller,
  idempotencyKey,
}: {
  traveller: SavedTraveller | null;
  idempotencyKey: string;
}) {
  const [state, action, pending] = useActionState(saveTravellerAction, MANAGE_IDLE);
  const hydrated = useHydrated();
  return (
    <form
      action={action}
      className="space-y-4"
      data-testid="traveller-profile-form"
      data-ready={hydrated || undefined}
    >
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {traveller ? (
        <>
          <input type="hidden" name="travellerId" value={traveller.id} />
          <input type="hidden" name="revision" value={traveller.revision} />
        </>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <Field name="title" label="Title (optional)" state={state}>
          {(props) => (
            <select {...props} defaultValue={traveller?.title ?? ''} className={input}>
              <option value="">—</option>
              {Object.entries(TRAVELLER_TITLES).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field name="givenName" label="Given names" state={state}>
          {(props) => (
            <input
              {...props}
              defaultValue={traveller?.givenName ?? ''}
              required
              className={input}
            />
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="middleName" label="Middle name (optional)" state={state}>
          {(props) => (
            <input {...props} defaultValue={traveller?.middleName ?? ''} className={input} />
          )}
        </Field>
        <Field name="familyName" label="Family name" state={state}>
          {(props) => (
            <input
              {...props}
              defaultValue={traveller?.familyName ?? ''}
              required
              className={input}
            />
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="dateOfBirth" label="Date of birth" state={state}>
          {(props) => (
            <input
              {...props}
              type="date"
              defaultValue={traveller?.dateOfBirth ?? ''}
              required
              className={input}
            />
          )}
        </Field>
        <Field name="nationality" label="Nationality" state={state}>
          {(props) => (
            <select
              {...props}
              defaultValue={traveller?.nationality ?? ''}
              required
              className={input}
            >
              <option value="">Choose…</option>
              {COUNTRIES.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <p className="text-xs text-ink-muted">
        Saved profiles hold names, date of birth, and nationality only — never passport or other
        travel-document details.
      </p>
      <Submit pending={pending} testId="traveller-profile-submit">
        {traveller ? 'Save changes' : 'Save traveller'}
      </Submit>
      <div aria-live="polite">
        <ActionResult state={state} />
      </div>
    </form>
  );
}

export function DeleteTravellerForm({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(deleteTravellerAction, MANAGE_IDLE);
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (
          !window.confirm(
            `Remove ${name} from your saved travellers? Existing bookings won’t change.`,
          )
        )
          event.preventDefault();
      }}
    >
      <input type="hidden" name="travellerId" value={id} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        aria-disabled={pending || undefined}
        data-testid={`delete-traveller-${id}`}
      >
        Remove<span className="sr-only"> {name}</span>
      </Button>
      <ActionResult state={state} />
    </form>
  );
}

export function LinkBookingsForm({
  trips,
  children,
}: {
  trips: TripSummary[];
  children: ReactNode;
}) {
  const [state, action, pending] = useActionState(linkBookingsAction, MANAGE_IDLE);
  const confirmError = state.status === 'error' ? state.fields?.confirm : undefined;
  return (
    <form action={action} className="space-y-4" data-testid="link-form">
      {children}
      <fieldset>
        <legend className="sr-only">Bookings to add</legend>
        <ul className="space-y-2">
          {trips.map((trip) => (
            <li key={trip.orderId}>
              <label className="flex items-center gap-3 rounded-2xl border border-line bg-white p-3 text-sm text-ink">
                <input
                  type="checkbox"
                  name="orderId"
                  value={trip.orderId}
                  defaultChecked
                  className="size-4 accent-primary"
                />
                <span className="min-w-0">
                  <span className="font-semibold tracking-wider tabular-nums">
                    {trip.reference}
                  </span>{' '}
                  · {trip.origin} → {trip.destination}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <label className="flex gap-3 text-sm text-ink">
        <input
          type="checkbox"
          name="confirm"
          value="yes"
          className="mt-0.5 size-4 accent-primary"
          aria-invalid={confirmError ? true : undefined}
          data-testid="link-confirm"
        />
        <span>
          Add the selected bookings to my account. From then on they open only when I’m signed in.
        </span>
      </label>
      {confirmError ? <p className="text-sm text-danger">{confirmError}</p> : null}
      <Submit pending={pending} testId="link-submit">
        Add to My Trips
      </Submit>
      <div aria-live="polite">
        <ActionResult state={state} />
      </div>
    </form>
  );
}
