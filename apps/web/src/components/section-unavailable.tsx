import { CloudOff } from 'lucide-react';

/** Fallback for an optional section whose data could not be loaded. */
export function SectionUnavailable({ title, message }: { title: string; message: string }) {
  return (
    <div
      role="status"
      className="flex items-start gap-4 rounded-card border border-line bg-surface p-6"
    >
      <CloudOff className="mt-0.5 size-6 shrink-0 text-ink-subtle" aria-hidden="true" />
      <div>
        <p className="font-semibold text-ink">{title}</p>
        <p className="mt-1 text-ink-muted">{message}</p>
      </div>
    </div>
  );
}
