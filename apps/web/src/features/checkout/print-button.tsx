'use client';

import { Button } from '@velasia/ui/button';
import { Printer } from 'lucide-react';

/** The browser's own print dialog (which also offers "Save as PDF"). */
export function PrintButton() {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => window.print()}
      data-testid="print-booking"
    >
      <Printer aria-hidden="true" />
      Print or save as PDF
    </Button>
  );
}
