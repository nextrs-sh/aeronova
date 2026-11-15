import type { OfferService, ServiceInclusion } from '@velasia/contracts';
import { cn } from '@velasia/ui/cn';
import { Check, CircleDollarSign, Minus } from 'lucide-react';

const INCLUSION: Record<
  ServiceInclusion,
  { icon: typeof Check; label: string; className: string }
> = {
  included: { icon: Check, label: 'Included', className: 'text-success' },
  fee: { icon: CircleDollarSign, label: 'Fee applies', className: 'text-gold-800' },
  'not-included': { icon: Minus, label: 'Not included', className: 'text-ink-subtle' },
};

/** Whether a service is included, charged for, or not part of the fare — never by colour alone. */
export function InclusionIcon({
  inclusion,
  className,
}: {
  inclusion: ServiceInclusion;
  className?: string;
}) {
  const { icon: Icon, label, className: tone } = INCLUSION[inclusion];
  return (
    <>
      <Icon className={cn('size-4 shrink-0', tone, className)} aria-hidden="true" />
      <span className="sr-only">{label}: </span>
    </>
  );
}

/** One service as a comparison cell: icon, short value, and the full condition. */
export function ServiceValue({
  service,
  detailed = false,
}: {
  service: OfferService | undefined;
  detailed?: boolean;
}) {
  if (!service) return <span className="text-ink-subtle">—</span>;
  return (
    <span className="flex gap-2">
      <InclusionIcon inclusion={service.inclusion} className="mt-0.5" />
      <span className="min-w-0">
        <span
          className={cn(
            'font-medium',
            service.inclusion === 'not-included' ? 'text-ink-muted' : 'text-ink',
          )}
        >
          {service.summary}
        </span>
        {detailed ? (
          <span className="mt-0.5 block text-xs leading-snug text-ink-muted">{service.detail}</span>
        ) : null}
      </span>
    </span>
  );
}
