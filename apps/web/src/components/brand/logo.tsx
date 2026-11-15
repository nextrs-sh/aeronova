import { cn } from '@velasia/ui/cn';

interface LogoMarkProps {
  className?: string;
  /** Colour of the gap stroke where the flight path crosses the star. */
  knockout?: string;
  starColor?: string;
}

/** The AeroNova mark: a four-point nova crossed by an orbiting flight path. */
export function LogoMark({
  className,
  knockout = '#ffffff',
  starColor = 'currentColor',
}: LogoMarkProps) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-8', className)}>
      <path
        d="M16 2.5c.9 7.6 4.9 11.6 13.5 13.5-8.6 1.9-12.6 5.9-13.5 13.5-.9-7.6-4.9-11.6-13.5-13.5C11.1 14.1 15.1 10.1 16 2.5Z"
        fill={starColor}
      />
      <path
        d="M3.5 21.5c5.6 6.3 18.6 5.8 25-8.5"
        fill="none"
        stroke={knockout}
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <path
        d="M3.5 21.5c5.6 6.3 18.6 5.8 25-8.5"
        fill="none"
        stroke="#ee6a1f"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface LogoProps {
  className?: string;
  tone?: 'default' | 'inverse';
}

export function Logo({ className, tone = 'default' }: LogoProps) {
  const inverse = tone === 'inverse';
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark
        className={inverse ? 'text-white' : 'text-navy-900'}
        knockout={inverse ? '#060e21' : '#ffffff'}
      />
      <span
        className={cn(
          'font-display text-[1.375rem] leading-none font-bold tracking-[-0.03em]',
          inverse ? 'text-white' : 'text-navy-900',
        )}
      >
        Aero<span className="font-extrabold">Nova</span>
      </span>
    </span>
  );
}
