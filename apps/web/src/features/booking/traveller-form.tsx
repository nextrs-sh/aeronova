'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { SavedTraveller } from '@velasia/contracts';
import {
  COUNTRIES,
  SPECIAL_ASSISTANCE,
  TRAVELLER_RULES,
  TRAVELLER_TITLES,
  addDays,
  createTravellersFormSchema,
  formatTravelDate,
  type TravellerRulesContext,
  type TravellersFormInput,
} from '@velasia/contracts';
import { Button } from '@velasia/ui/button';
import { cn } from '@velasia/ui/cn';
import { AlertTriangle, ArrowRight, Baby, Loader2, Mail, UserRound } from 'lucide-react';
import { startTransition, useActionState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useForm, type FieldPath, type UseFormRegisterReturn } from 'react-hook-form';
import { BOOKING_IDLE } from './action-state';
import { savePassengersAction } from './actions';

/*
 * Traveller details. React Hook Form validates with the same Zod schema (and trip rules) the
 * Server Action and the API apply, so errors appear inline before anything is sent. The form
 * still posts without JavaScript; the server then returns the same field errors.
 *
 * Personal data stays in this form's memory and the server-side session: nothing is written to
 * browser storage, the URL, or analytics.
 */

interface TravellerFormProps {
  rules: TravellerRulesContext;
  defaultValues: TravellersFormInput;
  version: number;
  /**
   * Milestone 6: the signed-in account's saved travellers. Choosing one fills that traveller's
   * fields in this form only; nothing is sent until the traveller saves, and the API validates
   * the details against the trip like any typed ones.
   */
  savedTravellers?: SavedTraveller[];
}

const inputClass =
  'block h-11 w-full rounded-xl border border-line-strong bg-white px-3 text-base text-ink shadow-xs placeholder:text-ink-subtle focus-visible:border-navy-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus aria-invalid:border-danger sm:text-sm';

function Field({
  id,
  label,
  optional = false,
  description,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  description?: string;
  error?: string;
  children: (props: {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: true;
  }) => ReactNode;
}) {
  const describedBy = [description ? `${id}-description` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink">
        {label}
        {optional ? <span className="font-normal text-ink-muted"> (optional)</span> : null}
      </label>
      {children({
        id,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { 'aria-invalid': true as const } : {}),
      })}
      {description ? (
        <p id={`${id}-description`} className="mt-1 text-xs text-ink-muted">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1 flex gap-1 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Select({
  registration,
  children,
  ...props
}: {
  registration: UseFormRegisterReturn;
  children: ReactNode;
  id: string;
  autoComplete?: string;
}) {
  return (
    <select {...props} {...registration} className={cn(inputClass, 'pr-8')}>
      {children}
    </select>
  );
}

export function TravellerForm({
  rules,
  defaultValues,
  version,
  savedTravellers = [],
}: TravellerFormProps) {
  const schema = useMemo(() => createTravellersFormSchema(rules), [rules]);
  const form = useForm<TravellersFormInput>({
    resolver: zodResolver(schema),
    defaultValues,
    mode: 'onTouched',
  });
  const {
    register,
    formState: { errors, isSubmitted },
  } = form;
  const [state, formAction, pending] = useActionState(savePassengersAction, BOOKING_IDLE);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  // Errors found by the server (the API is the authority) go on the same fields.
  useEffect(() => {
    if (state.status !== 'error' || !state.fieldErrors) return;
    for (const [path, message] of Object.entries(state.fieldErrors)) {
      form.setError(path as FieldPath<TravellersFormInput>, { type: 'server', message });
    }
    errorSummaryRef.current?.focus();
  }, [state, form]);

  const adults = rules.slots.filter((slot) => slot.type === 'adult');
  const first = formatTravelDate(rules.firstTravelDate);
  const fieldError = (path: string): string | undefined => {
    const parts = path.split('.');
    let node: unknown = errors;
    for (const part of parts) node = (node as Record<string, unknown> | undefined)?.[part];
    return (node as { message?: string } | undefined)?.message;
  };
  const errorCount = Object.keys(errors.passengers ?? {}).length + (errors.contact ? 1 : 0);

  return (
    <form
      action={formAction}
      noValidate
      onSubmit={(event) => {
        const target = event.currentTarget;
        void form.handleSubmit(() => {
          const data = new FormData(target);
          startTransition(() => formAction(data));
        })(event);
      }}
      className="space-y-6"
      data-testid="traveller-form"
    >
      <input type="hidden" name="version" value={version} />
      <div
        ref={errorSummaryRef}
        tabIndex={-1}
        aria-live="assertive"
        className="outline-none"
        data-testid="traveller-form-status"
      >
        {state.status === 'error' ? (
          <p
            role="alert"
            className="flex gap-2 rounded-xl bg-danger-surface p-3 text-sm text-danger"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {state.message}
          </p>
        ) : isSubmitted && errorCount > 0 ? (
          <p
            role="alert"
            className="flex gap-2 rounded-xl bg-danger-surface p-3 text-sm text-danger"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Please check the highlighted details.
          </p>
        ) : null}
      </div>

      <p className="rounded-2xl border border-gold-200 bg-gold-50 p-4 text-sm text-gold-900">
        Velasia is a fictional airline. Please use made-up details — don’t enter anyone’s real
        personal information. Names should match the traveller’s ID; no passport details are needed.
      </p>

      {rules.slots.map((slot, index) => {
        const prefix = `passengers.${index}` as const;
        const id = (field: string) => `traveller-${slot.id}-${field}`;
        const isInfant = slot.type === 'infant';
        const dobHint =
          slot.type === 'adult'
            ? `${TRAVELLER_RULES.adultMinAge} or older on ${first}.`
            : slot.type === 'child'
              ? `${TRAVELLER_RULES.childMinAge}–${TRAVELLER_RULES.childMaxAge} years old on ${first}.`
              : `Under 2 on every flight, and at least ${TRAVELLER_RULES.infantMinAgeDays} days old on ${first}.`;
        return (
          <fieldset
            key={slot.id}
            className="rounded-[1.5rem] border border-line bg-white p-5 shadow-card sm:p-6"
            data-testid={`traveller-${slot.id}`}
          >
            <legend className="sr-only">{slot.label}</legend>
            {savedTravellers.length ? (
              <div className="mb-4">
                <label htmlFor={id('saved')} className="text-sm font-semibold text-ink">
                  Fill in from a saved traveller
                </label>
                <select
                  id={id('saved')}
                  defaultValue=""
                  className={cn(inputClass, 'mt-1 pr-8')}
                  data-testid={`saved-traveller-${slot.id}`}
                  onChange={(event) => {
                    const chosen = savedTravellers.find((t) => t.id === event.target.value);
                    if (!chosen) return;
                    const fill = { shouldDirty: true, shouldValidate: isSubmitted } as const;
                    form.setValue(`${prefix}.title`, chosen.title ?? '', fill);
                    form.setValue(`${prefix}.givenName`, chosen.givenName, fill);
                    form.setValue(`${prefix}.middleName`, chosen.middleName ?? '', fill);
                    form.setValue(`${prefix}.familyName`, chosen.familyName, fill);
                    form.setValue(`${prefix}.dateOfBirth`, chosen.dateOfBirth, fill);
                    form.setValue(`${prefix}.nationality`, chosen.nationality, fill);
                  }}
                >
                  <option value="">Choose a saved traveller…</option>
                  {savedTravellers.map((traveller) => (
                    <option key={traveller.id} value={traveller.id}>
                      {traveller.givenName} {traveller.familyName} · born {traveller.dateOfBirth}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div aria-hidden="true" className="mb-5 flex items-center gap-3">
              <span className="inline-flex size-10 items-center justify-center rounded-full bg-navy-50 text-navy-700">
                {isInfant ? <Baby className="size-5" /> : <UserRound className="size-5" />}
              </span>
              <span>
                <span className="block font-display text-lg font-bold text-ink">{slot.label}</span>
                <span className="block text-sm text-ink-muted">
                  {slot.type === 'adult'
                    ? 'Aged 12 or over'
                    : slot.type === 'child'
                      ? 'Aged 2 to 11, with their own seat'
                      : 'Under 2, travelling on an adult’s lap'}
                </span>
              </span>
            </div>
            <input type="hidden" {...register(`${prefix}.id`)} />
            <input type="hidden" {...register(`${prefix}.type`)} />
            <div className="grid gap-4 sm:grid-cols-2">
              {slot.type === 'adult' ? (
                <Field
                  id={id('title')}
                  label="Title"
                  optional
                  error={fieldError(`${prefix}.title`)}
                >
                  {(props) => (
                    <Select
                      {...props}
                      registration={register(`${prefix}.title`)}
                      autoComplete="honorific-prefix"
                    >
                      <option value="">No title</option>
                      {Object.entries(TRAVELLER_TITLES).map(([code, label]) => (
                        <option key={code} value={code}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : (
                <input type="hidden" {...register(`${prefix}.title`)} />
              )}
              <Field
                id={id('givenName')}
                label="Given names"
                description="As on the traveller’s ID."
                error={fieldError(`${prefix}.givenName`)}
              >
                {(props) => (
                  <input
                    {...props}
                    {...register(`${prefix}.givenName`)}
                    className={inputClass}
                    autoComplete={index === 0 ? 'given-name' : 'off'}
                    autoCapitalize="words"
                    spellCheck={false}
                  />
                )}
              </Field>
              <Field
                id={id('middleName')}
                label="Middle name"
                optional
                error={fieldError(`${prefix}.middleName`)}
              >
                {(props) => (
                  <input
                    {...props}
                    {...register(`${prefix}.middleName`)}
                    className={inputClass}
                    autoComplete={index === 0 ? 'additional-name' : 'off'}
                    spellCheck={false}
                  />
                )}
              </Field>
              <Field
                id={id('familyName')}
                label="Family name"
                error={fieldError(`${prefix}.familyName`)}
              >
                {(props) => (
                  <input
                    {...props}
                    {...register(`${prefix}.familyName`)}
                    className={inputClass}
                    autoComplete={index === 0 ? 'family-name' : 'off'}
                    autoCapitalize="words"
                    spellCheck={false}
                  />
                )}
              </Field>
              <Field
                id={id('dateOfBirth')}
                label="Date of birth"
                description={dobHint}
                error={fieldError(`${prefix}.dateOfBirth`)}
              >
                {(props) => (
                  <input
                    {...props}
                    {...register(`${prefix}.dateOfBirth`)}
                    type="date"
                    min="1906-01-01"
                    max={addDays(
                      rules.firstTravelDate,
                      isInfant ? -TRAVELLER_RULES.infantMinAgeDays : 0,
                    )}
                    className={inputClass}
                    autoComplete={index === 0 ? 'bday' : 'off'}
                  />
                )}
              </Field>
              <Field
                id={id('nationality')}
                label="Nationality"
                error={fieldError(`${prefix}.nationality`)}
              >
                {(props) => (
                  <Select {...props} registration={register(`${prefix}.nationality`)}>
                    <option value="">Choose a nationality</option>
                    {COUNTRIES.map((country) => (
                      <option key={country.code} value={country.code}>
                        {country.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {isInfant ? (
                <Field
                  id={id('infantOf')}
                  label="Travels on the lap of"
                  description="Each adult can travel with one lap infant."
                  error={fieldError(`${prefix}.infantOf`)}
                >
                  {(props) => (
                    <Select {...props} registration={register(`${prefix}.infantOf`)}>
                      <option value="">Choose an adult</option>
                      {adults.map((adult) => (
                        <option key={adult.id} value={adult.id}>
                          {adult.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : (
                <input type="hidden" {...register(`${prefix}.infantOf`)} />
              )}
              <Field
                id={id('specialAssistance')}
                label="Special assistance"
                optional
                description="We’ll note the request for the airport team. No medical details needed."
                error={fieldError(`${prefix}.specialAssistance`)}
              >
                {(props) => (
                  <Select {...props} registration={register(`${prefix}.specialAssistance`)}>
                    <option value="">No assistance needed</option>
                    {Object.entries(SPECIAL_ASSISTANCE).map(([code, label]) => (
                      <option key={code} value={code}>
                        {label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </fieldset>
        );
      })}

      <fieldset
        className="rounded-[1.5rem] border border-line bg-white p-5 shadow-card sm:p-6"
        data-testid="traveller-contact"
      >
        <legend className="sr-only">Contact details</legend>
        <div aria-hidden="true" className="mb-5 flex items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-full bg-navy-50 text-navy-700">
            <Mail className="size-5" />
          </span>
          <span>
            <span className="block font-display text-lg font-bold text-ink">Contact details</span>
            <span className="block text-sm text-ink-muted">
              Where we’d send trip updates. This demo never sends any messages.
            </span>
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="contact-email" label="Email" error={fieldError('contact.email')}>
            {(props) => (
              <input
                {...props}
                {...register('contact.email')}
                type="email"
                inputMode="email"
                autoComplete="email"
                spellCheck={false}
                className={inputClass}
              />
            )}
          </Field>
          <Field
            id="contact-phone"
            label="Mobile phone"
            description="With the country code, for example +63 917 555 0123."
            error={fieldError('contact.phone')}
          >
            {(props) => (
              <input
                {...props}
                {...register('contact.phone')}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                className={inputClass}
              />
            )}
          </Field>
        </div>
      </fieldset>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
        <p className="text-sm text-ink-muted sm:mr-auto">
          Saved only in your booking session, for a limited time.
        </p>
        <Button
          type="submit"
          size="lg"
          aria-disabled={pending || undefined}
          onClick={(event) => {
            if (pending) event.preventDefault();
          }}
          data-testid="save-travellers"
        >
          {pending ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : null}
          {pending ? 'Saving…' : 'Save and choose seats'}
          {pending ? null : <ArrowRight aria-hidden="true" />}
        </Button>
      </div>
    </form>
  );
}
