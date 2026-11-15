import { cn } from '@velasia/ui/cn';
import {
  LOCKUP,
  SYMBOL_BOX,
  SYMBOL_LEAD,
  SYMBOL_TRAIL,
  WORDMARK_NAME,
  WORDMARK_SUB,
} from './logo-geometry';

/*
 * The Velasia Airways identity, inlined so it is crisp at any size and needs no extra request.
 * Geometry is generated with the files in /public/brand — see docs/BRAND-GUIDELINES.md.
 * Both components are decorative: wrap them in a labelled link or heading.
 */

type Tone = 'default' | 'inverse';

const COLORS: Record<Tone, { lead: string; trail: string; name: string; sub: string }> = {
  // On light surfaces: navy with the Velasia Crimson blade.
  default: { lead: '#101E38', trail: '#B42332', name: '#101E38', sub: '#172B49' },
  // On navy or dark imagery: white with the lighter crimson-400.
  inverse: { lead: '#FFFFFF', trail: '#E8707D', name: '#FFFFFF', sub: '#E8707D' },
};

interface LogoMarkProps {
  className?: string;
  tone?: Tone;
}

/** The Velasia symbol: two swept wing blades forming a V on a shared horizon line. */
export function LogoMark({ className, tone = 'default' }: LogoMarkProps) {
  const colors = COLORS[tone];
  const { x, y, width, height } = SYMBOL_BOX;
  return (
    <svg
      viewBox={`${x} ${y} ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
      className={cn('h-8 w-auto', className)}
    >
      <path fill={colors.lead} d={SYMBOL_LEAD} />
      <path fill={colors.trail} d={SYMBOL_TRAIL} />
    </svg>
  );
}

interface LogoProps {
  className?: string;
  tone?: Tone;
}

/** The horizontal lockup: symbol plus the VELASIA / AIRWAYS wordmark. */
export function Logo({ className, tone = 'default' }: LogoProps) {
  const colors = COLORS[tone];
  return (
    <svg
      viewBox={`0 0 ${LOCKUP.width} ${LOCKUP.height}`}
      aria-hidden="true"
      focusable="false"
      data-brand-logo={tone}
      className={cn('h-9 w-auto', className)}
    >
      <g transform={LOCKUP.symbolTransform}>
        <path fill={colors.lead} d={SYMBOL_LEAD} />
        <path fill={colors.trail} d={SYMBOL_TRAIL} />
      </g>
      <g transform={LOCKUP.wordmarkTransform}>
        <path fill={colors.name} transform={WORDMARK_NAME.transform} d={WORDMARK_NAME.d} />
        <path fill={colors.sub} transform={WORDMARK_SUB.transform} d={WORDMARK_SUB.d} />
      </g>
    </svg>
  );
}
