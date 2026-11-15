import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn';

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Velasia Crimson: reserve `primary` for the one key action per view.
        primary:
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover active:bg-primary-active',
        secondary: 'bg-navy-900 text-white shadow-sm hover:bg-navy-800 active:bg-navy-950',
        outline:
          'border border-line-strong bg-white text-ink hover:border-navy-300 hover:bg-surface',
        ghost: 'text-ink hover:bg-surface',
        inverse: 'bg-white text-navy-900 shadow-sm hover:bg-navy-50',
        link: 'h-auto rounded-none px-0 text-primary underline-offset-4 hover:text-primary-hover hover:underline',
      },
      size: {
        sm: 'h-9 px-4 text-sm',
        md: 'h-11 px-5 text-sm',
        lg: 'h-13 px-7 text-base',
        icon: 'size-10',
      },
    },
    compoundVariants: [{ variant: 'link', className: 'h-auto px-0' }],
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a Next.js `Link`) with button styles. */
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot.Root : 'button';
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
