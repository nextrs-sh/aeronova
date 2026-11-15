#!/usr/bin/env node
/*
 * Velasia Airways brand asset generator.
 *
 * Every brand asset is derived from the single symbol geometry and wordmark settings below, so
 * the SVGs, PNGs, and the React logo component can never drift apart. Run it only when the
 * identity itself changes; the generated files are committed.
 *
 * The generator's tools are deliberately NOT workspace dependencies. Install them once into a
 * scratch directory and point BRAND_DEPS at it:
 *
 *   npm i --prefix /tmp/velasia-brand opentype.js@1.3.4 @fontsource/manrope@5.1.1 sharp@0.34.5
 *   BRAND_DEPS=/tmp/velasia-brand node scripts/brand/generate-brand-assets.mjs
 *
 * The wordmark is Manrope (SIL Open Font License 1.1), converted to outlines so no asset depends
 * on a webfont being available.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const depsDir = process.env.BRAND_DEPS;
if (!depsDir) {
  console.error('Set BRAND_DEPS to a directory with opentype.js, @fontsource/manrope, and sharp.');
  process.exit(1);
}
const require = createRequire(path.join(path.resolve(depsDir), 'noop.js'));
const opentype = require('opentype.js');
const sharp = require('sharp');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(root, 'apps/web/public/brand');
const geometryModule = path.join(root, 'apps/web/src/components/brand/logo-geometry.ts');
fs.mkdirSync(publicDir, { recursive: true });

/* ---------------------------------------------------------------- palette */
const C = {
  midnight: '#101E38',
  deep: '#172B49',
  crimson: '#B42332', // Velasia Crimson — the symbol blade on light backgrounds
  crimsonOnDark: '#E8707D', // crimson-400 — blade and AIRWAYS on navy (5.57:1 on midnight)
  navy200: '#C3CEDF',
  white: '#FFFFFF',
};

/* ---------------------------------------------------------------- symbol */
// Two swept wing blades form a V and stand on a shared horizon line (y = 54) on a 64-unit grid.
// The leading (left) blade carries the navy; the trailing blade, which climbs past the frame
// towards the top-right, carries the crimson.
const LEAD = 'M5 10H19Q23.5 30 33.5 46.5L29.5 54Q16 33 5 10Z';
const TRAIL = 'M34.5 54Q42.5 29 60 5Q51.5 30.5 41.5 54Z';
const SYMBOL_BOX = { x: 5, y: 5, w: 55, h: 49 };
const symbolPaths = (lead, trail) =>
  `<path fill="${lead}" d="${LEAD}"/><path fill="${trail}" d="${TRAIL}"/>`;

/* ---------------------------------------------------------------- wordmark */
const loadFont = (weight) => {
  const file = fs.readFileSync(
    require.resolve(`@fontsource/manrope/files/manrope-latin-${weight}-normal.woff`),
  );
  // Copy out the file's own bytes: Node may back small Buffers with a shared, larger pool.
  return opentype.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
};
const semibold = loadFont(600);
const medium = loadFont(500);

const round = (n) => Math.round(n * 100) / 100;

function layout(font, text, capHeight, tracking) {
  const upm = font.unitsPerEm;
  const size = (capHeight * upm) / (font.tables.os2.sCapHeight || 0.72 * upm);
  const scale = size / upm;
  const glyphs = font.stringToGlyphs(text);
  const paths = [];
  let x = 0;
  glyphs.forEach((glyph, i) => {
    paths.push(glyph.getPath(x, capHeight, size));
    x += glyph.advanceWidth * scale;
    if (i < glyphs.length - 1) {
      x += font.getKerningValue(glyph, glyphs[i + 1]) * scale + tracking;
    }
  });
  const boxes = paths.map((p) => p.getBoundingBox());
  const x1 = Math.min(...boxes.map((b) => b.x1));
  const x2 = Math.max(...boxes.map((b) => b.x2));
  return {
    d: paths.map((p) => p.toPathData(2)).join(''),
    x1,
    width: x2 - x1,
    size,
    count: glyphs.length,
  };
}

const NAME_CAP = 22;
const SUB_CAP = 7.6;
const LINE_GAP = 7.4;
const nameProbe = layout(semibold, 'VELASIA', NAME_CAP, 0);
const name = layout(semibold, 'VELASIA', NAME_CAP, 0.15 * nameProbe.size);
// AIRWAYS is justified to exactly the width of VELASIA: solve its tracking linearly.
const sub0 = layout(medium, 'AIRWAYS', SUB_CAP, 0);
const sub = layout(medium, 'AIRWAYS', SUB_CAP, (name.width - sub0.width) / (sub0.count - 1));
const WORD_W = name.width;
const WORD_H = NAME_CAP + LINE_GAP + SUB_CAP;
const NAME_D = name.d;
const SUB_D = sub.d;
const NAME_SHIFT = { x: -name.x1, y: 0 };
const SUB_SHIFT = { x: -sub.x1, y: NAME_CAP + LINE_GAP };

const wordmarkGroup = (x, y, nameFill, subFill) =>
  `<g transform="translate(${round(x)} ${round(y)})">` +
  `<path fill="${nameFill}" transform="translate(${round(NAME_SHIFT.x)} 0)" d="${NAME_D}"/>` +
  `<path fill="${subFill}" transform="translate(${round(SUB_SHIFT.x)} ${round(SUB_SHIFT.y)})" d="${SUB_D}"/>` +
  `</g>`;

/* ---------------------------------------------------------------- lockup */
// The symbol is ~1.22x the wordmark block height (optical balance for its open V shape);
// the gap between symbol and wordmark is 0.42x the symbol height.
const SYM_H = WORD_H * 1.22;
const SYM_SCALE = SYM_H / SYMBOL_BOX.h;
const SYM_W = SYMBOL_BOX.w * SYM_SCALE;
const GAP = SYM_H * 0.42;
const LOCK_W = SYM_W + GAP + WORD_W;
const LOCK_H = SYM_H;
const WORD_X = SYM_W + GAP;
const WORD_Y = (LOCK_H - WORD_H) / 2 + 0.6;
const SYM_TRANSFORM = `translate(${round(-SYMBOL_BOX.x * SYM_SCALE)} ${round(-SYMBOL_BOX.y * SYM_SCALE)}) scale(${round(SYM_SCALE * 1000) / 1000})`;

const lockup = (lead, trail, nameFill, subFill) =>
  `<g transform="${SYM_TRANSFORM}">${symbolPaths(lead, trail)}</g>` +
  wordmarkGroup(WORD_X, WORD_Y, nameFill, subFill);

const svg = (w, h, body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(w)} ${round(h)}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;

const write = (file, contents) => {
  fs.writeFileSync(path.join(publicDir, file), contents);
  console.log(`  ${file}`);
};

console.log('apps/web/public/brand/');
write('velasia-symbol.svg', svg(64, 64, symbolPaths(C.midnight, C.crimson), 'Velasia Airways'));
write(
  'velasia-wordmark.svg',
  svg(WORD_W, WORD_H, wordmarkGroup(0, 0, C.midnight, C.deep), 'Velasia Airways'),
);
// Primary: full colour, for light backgrounds.
write(
  'velasia-logo.svg',
  svg(LOCK_W, LOCK_H, lockup(C.midnight, C.crimson, C.midnight, C.deep), 'Velasia Airways'),
);
// For light backgrounds when only one ink is available (print, embossing, monochrome UI).
write(
  'velasia-logo-light.svg',
  svg(LOCK_W, LOCK_H, lockup(C.midnight, C.midnight, C.midnight, C.midnight), 'Velasia Airways'),
);
// Reversed: for navy or photographic dark backgrounds.
write(
  'velasia-logo-dark.svg',
  svg(
    LOCK_W,
    LOCK_H,
    lockup(C.white, C.crimsonOnDark, C.white, C.crimsonOnDark),
    'Velasia Airways',
  ),
);

// Favicon: the reversed symbol on a midnight tile, nudged down for optical centring.
const tile = (rx) =>
  `<rect width="64" height="64" rx="${rx}" fill="${C.midnight}"/>` +
  `<g transform="translate(5.5 7.5) scale(.84)">${symbolPaths(C.white, C.crimsonOnDark)}</g>`;
write('velasia-favicon.svg', svg(64, 64, tile(14), 'Velasia Airways'));

/* ---------------------------------------------------------------- raster icons */
// Full-bleed square: iOS and Android apply their own corner masks.
const iconSvg = Buffer.from(svg(64, 64, tile(0), 'Velasia Airways'));
async function png(input, file, width, height = width, { palette = true } = {}) {
  await sharp(input, { density: 600 })
    .resize(width, height)
    .png(
      palette
        ? { compressionLevel: 9, palette: true, quality: 90, effort: 10 }
        : { compressionLevel: 9 },
    )
    .toFile(path.join(publicDir, file));
  console.log(`  ${file} (${fs.statSync(path.join(publicDir, file)).size} bytes)`);
}
await png(iconSvg, 'velasia-apple-touch-icon.png', 180);
await png(iconSvg, 'velasia-icon-512.png', 512);

/* ---------------------------------------------------------------- social preview */
const W = 1200;
const H = 630;
const tagline = layout(semibold, 'Beyond every horizon.', 46, 0);
const caption = layout(medium, 'A fictional airline retailing demo', 17, 0.6);
const wordScale = 2.9;
const bigSym = 290 / SYMBOL_BOX.h;
const social = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
<defs>
  <radialGradient id="glow" cx="78%" cy="18%" r="75%">
    <stop offset="0" stop-color="${C.deep}"/><stop offset="1" stop-color="${C.midnight}"/>
  </radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#glow)"/>
<path d="M-40 ${H} L-40 548 Q${W / 2} 470 ${W + 40} 548 L${W + 40} ${H} Z" fill="${C.deep}"/>
<path d="M-40 548 Q${W / 2} 470 ${W + 40} 548" fill="none" stroke="${C.crimsonOnDark}" stroke-width="2.5"/>
<g transform="translate(${810 - SYMBOL_BOX.x * bigSym} ${509 - 54 * bigSym}) scale(${round(bigSym * 1000) / 1000})">${symbolPaths(C.white, C.crimsonOnDark)}</g>
<g transform="translate(96 150) scale(${wordScale})">${wordmarkGroup(0, 0, C.white, C.crimsonOnDark)}</g>
<path fill="${C.white}" transform="translate(${round(96 - tagline.x1)} 338)" d="${tagline.d}"/>
<path fill="${C.navy200}" transform="translate(${round(98 - caption.x1)} 418)" d="${caption.d}"/>
</svg>`;
// Truecolour: palette quantisation bands the background gradient.
await png(Buffer.from(social), 'velasia-social-preview.png', W, H, { palette: false });

/* ---------------------------------------------------------------- React geometry */
const ts = `// Generated by scripts/brand/generate-brand-assets.mjs — do not edit by hand.
// Outlined Manrope (SIL OFL 1.1) wordmark and the Velasia symbol geometry.

/** Leading wing blade of the symbol (64-unit grid). */
export const SYMBOL_LEAD = '${LEAD}';
/** Trailing wing blade of the symbol, the crimson accent (64-unit grid). */
export const SYMBOL_TRAIL = '${TRAIL}';
/** Tight bounds of the symbol inside its 64-unit grid. */
export const SYMBOL_BOX = { x: ${SYMBOL_BOX.x}, y: ${SYMBOL_BOX.y}, width: ${SYMBOL_BOX.w}, height: ${SYMBOL_BOX.h} } as const;

/** Horizontal lockup canvas. */
export const LOCKUP = {
  width: ${round(LOCK_W)},
  height: ${round(LOCK_H)},
  symbolTransform: '${SYM_TRANSFORM}',
  wordmarkTransform: 'translate(${round(WORD_X)} ${round(WORD_Y)})',
} as const;

/** "VELASIA" outline, positioned at the wordmark origin. */
export const WORDMARK_NAME = {
  transform: 'translate(${round(NAME_SHIFT.x)} 0)',
  d: '${NAME_D}',
} as const;
/** "AIRWAYS" outline, justified to the width of the name. */
export const WORDMARK_SUB = {
  transform: 'translate(${round(SUB_SHIFT.x)} ${round(SUB_SHIFT.y)})',
  d: '${SUB_D}',
} as const;
`;
fs.writeFileSync(geometryModule, ts);
console.log(`\n${path.relative(root, geometryModule)}`);
