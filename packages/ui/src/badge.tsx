import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from './cn';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide [&_svg]:size-3.5',
  {
    variants: {
      tone: {
        neutral: 'bg-surface text-ink-muted ring-1 ring-line ring-inset',
        navy: 'bg-navy-50 text-navy-700 ring-1 ring-navy-100 ring-inset',
        ember: 'bg-ember-50 text-ember-700 ring-1 ring-ember-100 ring-inset',
        inverse: 'bg-white/15 text-white ring-1 ring-white/25 backdrop-blur-sm ring-inset',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps extends ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
