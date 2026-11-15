import { Container } from '@aeronova/ui/container';
import type { ReactNode } from 'react';

interface PageIntroProps {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}

/** Navy banner used at the top of inner pages. */
export function PageIntro({ eyebrow, title, description, children }: PageIntroProps) {
  return (
    <div className="relative overflow-hidden bg-navy-950 text-white">
      <div
        aria-hidden="true"
        className="absolute -top-40 -right-32 size-[32rem] rounded-full bg-[radial-gradient(circle,rgb(238_106_31/0.22),transparent_65%)]"
      />
      <Container className="relative py-14 sm:py-16 lg:py-20">
        {eyebrow ? (
          <p className="text-xs font-bold tracking-[0.16em] text-ember-300 uppercase">{eyebrow}</p>
        ) : null}
        <h1 className="mt-2 max-w-3xl text-4xl font-bold sm:text-5xl">{title}</h1>
        {description ? (
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-navy-100">{description}</p>
        ) : null}
        {children}
      </Container>
    </div>
  );
}
