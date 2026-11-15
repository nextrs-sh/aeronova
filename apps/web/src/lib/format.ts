import type { Money } from '@aeronova/contracts';

const LOCALE = 'en-PH';

export function formatMoney({ amount, currency }: Money): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** `265` → `4h 25m` */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** `14` → `2× daily`, `7` → `Daily`, `4` → `4× weekly` */
export function formatFrequency(weekly: number): string {
  if (weekly % 7 === 0) return weekly === 7 ? 'Daily' : `${weekly / 7}× daily`;
  return `${weekly}× weekly`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
