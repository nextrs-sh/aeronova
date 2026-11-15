'use client';

import { Button } from '@aeronova/ui/button';
import { Sheet, SheetContent } from '@aeronova/ui/sheet';
import { PencilLine, X } from 'lucide-react';
import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react';

const DESKTOP = '(min-width: 1024px)';
export const EDIT_SEARCH_HASH = 'edit-search';

function subscribe(onChange: () => void) {
  const query = window.matchMedia(DESKTOP);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** `false` during SSR and hydration; the panel starts closed, so nothing differs. */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP).matches,
    () => false,
  );
}

/**
 * "Edit search": an inline panel on desktop, a bottom sheet on phones and
 * tablets. The search form (passed in as children) is mounted once, only
 * while open, so field ids stay unique.
 */
export function EditSearch({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const desktop = useIsDesktop();
  const panelId = useId();

  // Links to `#edit-search` (e.g. from an empty state) open the editor.
  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash !== `#${EDIT_SEARCH_HASH}`) return;
      setOpen(true);
      history.replaceState(null, '', window.location.pathname + window.location.search);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, []);

  return (
    <>
      <Button
        variant="inverse"
        size="md"
        aria-expanded={open}
        aria-controls={open && desktop ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="w-full shrink-0 sm:w-auto"
      >
        {open && desktop ? <X aria-hidden="true" /> : <PencilLine aria-hidden="true" />}
        {open && desktop ? 'Close' : 'Edit search'}
      </Button>

      {desktop ? (
        open ? (
          <div
            id={panelId}
            className="order-last w-full basis-full rounded-[1.75rem] bg-white p-6 text-ink shadow-float ring-1 ring-navy-900/5 motion-safe:animate-in-pop lg:p-7"
          >
            <h2 className="mb-4 font-display text-lg font-bold">Change your search</h2>
            {children}
          </div>
        ) : null
      ) : (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" title="Change your search" closeLabel="Close search">
            <div className="px-4 py-5 sm:px-6">{children}</div>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
