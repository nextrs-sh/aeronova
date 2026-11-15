import { cn } from '@aeronova/ui/cn';
import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

interface FieldShellProps {
  label: string;
  htmlFor: string;
  icon?: ReactNode;
  error?: string;
  errorId: string;
  className?: string;
  children: ReactNode;
}

/** Labelled, bordered container used by every search field. */
export function FieldShell({
  label,
  htmlFor,
  icon,
  error,
  errorId,
  className,
  children,
}: FieldShellProps) {
  return (
    <div className={cn('min-w-0', className)}>
      <div
        className={cn(
          'relative flex min-h-16 items-center gap-3 rounded-xl border bg-white px-4 transition-[border-color,box-shadow] duration-150',
          'focus-within:border-navy-500 focus-within:ring-4 focus-within:ring-navy-500/10',
          error ? 'border-danger' : 'border-line-strong hover:border-navy-300',
        )}
      >
        {icon ? (
          <span className="shrink-0 text-ink-subtle [&_svg]:size-5" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col py-2">
          <label
            htmlFor={htmlFor}
            className="text-[0.6875rem] leading-4 font-semibold tracking-[0.12em] text-ink-subtle uppercase"
          >
            {label}
          </label>
          {children}
        </div>
      </div>
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1.5 px-1 text-sm font-medium text-danger">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}

export const fieldInputClass =
  'w-full min-w-0 truncate bg-transparent text-base leading-6 font-semibold text-ink outline-none placeholder:font-medium placeholder:text-ink-subtle';
