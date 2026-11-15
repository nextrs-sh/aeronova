import type { ComponentProps } from 'react';
import { cn } from './cn';

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse rounded-xl bg-navy-100/60 motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}
