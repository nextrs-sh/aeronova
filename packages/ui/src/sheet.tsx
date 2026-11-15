'use client';

import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

const SIDES = {
  right: 'inset-y-0 right-0 w-[min(24rem,100vw)] data-[state=open]:animate-in-slide',
  bottom: 'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-3xl data-[state=open]:animate-in-slide-up',
  /** A bottom sheet on phones, a wide side panel from the `sm` breakpoint. */
  responsive:
    'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-3xl data-[state=open]:animate-in-slide-up sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:max-h-none sm:w-[min(32rem,100vw)] sm:rounded-none sm:data-[state=open]:animate-in-slide',
} as const;

interface SheetContentProps extends Omit<ComponentProps<typeof DialogPrimitive.Content>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  /** Visually hide the title while keeping it for assistive technology. */
  hideTitle?: boolean;
  side?: keyof typeof SIDES;
  /** Accessible name of the close button. */
  closeLabel?: string;
  /** Pinned below the scrolling body, e.g. a primary action. */
  footer?: ReactNode;
}

/** A side or bottom panel built on an accessible modal dialog. */
export function SheetContent({
  className,
  children,
  title,
  description,
  hideTitle = false,
  side = 'right',
  closeLabel = 'Close menu',
  footer,
  ...props
}: SheetContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-navy-950/50 backdrop-blur-[2px] data-[state=open]:animate-in-fade motion-reduce:animate-none" />
      <DialogPrimitive.Content
        className={cn(
          'fixed z-50 flex flex-col bg-white shadow-float outline-none motion-reduce:animate-none',
          SIDES[side],
          className,
        )}
        {...(description ? {} : { 'aria-describedby': undefined })}
        {...props}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <DialogPrimitive.Title
            className={cn('font-display text-lg font-semibold text-ink', hideTitle && 'sr-only')}
          >
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close
            className="-mr-2 inline-flex size-10 items-center justify-center rounded-full text-ink-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
            aria-label={closeLabel}
          >
            <X className="size-5" aria-hidden="true" />
          </DialogPrimitive.Close>
        </div>
        {description ? (
          <DialogPrimitive.Description className="sr-only">
            {description}
          </DialogPrimitive.Description>
        ) : null}
        {/* Focusable so keyboard users can scroll long content with the arrow keys. */}
        <div
          tabIndex={0}
          className="flex-1 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        >
          {children}
        </div>
        {footer ? <div className="border-t border-line bg-white px-5 py-4">{footer}</div> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
