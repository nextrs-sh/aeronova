'use client';

import { Button } from '@velasia/ui/button';
import { Loader2, RotateCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/** Re-render the page on the server, fetching fresh results. */
export function RetryButton({ label = 'Try again' }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      aria-disabled={pending || undefined}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? (
        <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : (
        <RotateCw aria-hidden="true" />
      )}
      {pending ? 'Retrying…' : label}
    </Button>
  );
}
