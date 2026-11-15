import { cn } from '@velasia/ui/cn';
import type { ReactNode } from 'react';

interface SectionHeadingProps {
  id: string;
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  tone?: 'default' | 'inverse';
}

export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  action,
  className,
  tone = 'default',
}: SectionHeadingProps) {
  const inverse = tone === 'inverse';
  return (
    <div
      className={cn('flex flex-col gap-5 md:flex-row md:items-end md:justify-between', className)}
    >
      <div className="max-w-2xl">
        {eyebrow ? (
          <p
            className={cn(
              'text-xs font-bold tracking-[0.16em] uppercase',
              inverse ? 'text-gold-300' : 'text-gold-700',
            )}
          >
            {eyebrow}
          </p>
        ) : null}
        <h2
          id={id}
          className={cn('mt-2 text-3xl font-bold sm:text-4xl', inverse ? 'text-white' : 'text-ink')}
        >
          {title}
        </h2>
        {description ? (
          <p
            className={cn(
              'mt-3 text-lg leading-relaxed',
              inverse ? 'text-navy-100' : 'text-ink-muted',
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
