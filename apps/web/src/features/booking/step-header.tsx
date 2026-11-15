import { Container } from '@velasia/ui/container';
import type { ReactNode } from 'react';

/**
 * The static top of every booking step: prerendered, so it appears instantly while the
 * guest's session streams in below it.
 */
export function StepHeader({
  step,
  title,
  description,
}: {
  step: number;
  title: string;
  description: ReactNode;
}) {
  return (
    <div className="bg-navy-950 text-white">
      <Container className="py-8 sm:py-10">
        <p className="text-xs font-bold tracking-[0.16em] text-gold-300 uppercase">
          Book your trip · Step {step} of 4
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-base text-navy-100 sm:text-lg">{description}</p>
      </Container>
    </div>
  );
}
