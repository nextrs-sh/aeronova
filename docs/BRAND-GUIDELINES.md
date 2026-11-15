# Velasia Airways brand guidelines

**Beyond every horizon.**

Velasia Airways is a fictional, modern, premium full-service airline from the Philippines. The
brand should feel elegant, reliable, contemporary, welcoming, and international. These guidelines
cover what you need to use the identity correctly in this project.

> Velasia Airways is fictional. Do not present it, or these assets, as a real airline.

## Logo

![Velasia Airways logo](../apps/web/public/brand/velasia-logo.svg)

**The symbol** is two swept wing blades forming a V. Both blades stand on one shared, flat base:
the horizon. The leading blade is navy and tapers towards the horizon. The trailing blade is gold
and climbs past the top of the frame. This is the brand's forward motion, and the idea behind the
line "beyond every horizon". The symbol is recognisable without the wordmark.

**The wordmark** is VELASIA in Manrope SemiBold, tracked +150, set over AIRWAYS in Manrope
Medium. AIRWAYS is spaced out so its width matches VELASIA exactly. Both are converted to
outlines, so the logo never depends on a font being installed.

### Variations

| File (in `apps/web/public/brand/`) | Use it for                                                          |
| ---------------------------------- | ------------------------------------------------------------------- |
| `velasia-logo.svg`                 | **Primary.** Full colour, on white and light surfaces.              |
| `velasia-logo-dark.svg`            | Reversed (white + Warm Gold), on navy, dark, or photographic areas. |
| `velasia-logo-light.svg`           | One colour, navy, on light surfaces when gold is unavailable.       |
| `velasia-wordmark.svg`             | Wordmark only, where the symbol already appears nearby.             |
| `velasia-symbol.svg`               | Symbol only: avatars, app tiles, small brand marks.                 |
| `velasia-favicon.svg`              | Browser tab icon (symbol reversed on a Midnight Navy tile).         |
| `velasia-apple-touch-icon.png`     | 180 × 180 home-screen icon (full bleed; iOS rounds the corners).    |
| `velasia-icon-512.png`             | 512 × 512 web-app manifest icon.                                    |
| `velasia-social-preview.png`       | 1200 × 630 Open Graph and Twitter card.                             |

In the app, use the `Logo` and `LogoMark` components (`apps/web/src/components/brand/logo.tsx`).
Use `tone="default"` on light surfaces and `tone="inverse"` on navy. Both components are
decorative (`aria-hidden`), so always wrap them in a labelled element, for example
`<Link aria-label="Velasia Airways home">`.

### Clear space and minimum size

- **Clear space:** keep a margin of at least the height of the symbol's gold blade tip around
  the lockup. As a rule, use ½ × the logo's height. Never place text or edges inside it.
- **Minimum size:** full lockup 28 px tall on screen (AIRWAYS stays legible down to this size).
  Symbol alone: 16 px. Below 28 px, use the symbol or the favicon instead of the lockup.

### Don't

- Recolour the blades, swap their colours, or add gradients, outlines, shadows, or glows.
- Stretch, rotate, or re-space the wordmark, or retype it in a live font.
- Place the primary (navy) logo on navy or busy photography. Use the reversed version.
- Put the symbol in a circle on a light background. The navy tile or disc is reserved for
  favicons and the carrier mark in flight results.

## Colour

| Token                    | Hex       | Role                                                            |
| ------------------------ | --------- | --------------------------------------------------------------- |
| Midnight Navy `navy-950` | `#101E38` | Primary brand surface, ink, demo notice, footer, `theme-color`. |
| Deep Navy `navy-900`     | `#172B49` | Secondary navy surfaces, selected states, `secondary` buttons.  |
| Warm Gold `gold-400`     | `#EFB86A` | Selective emphasis: the primary CTA, accents on navy.           |
| Soft White `surface`     | `#F8FAFC` | Section backgrounds and quiet panels.                           |
| Cool Gray `ink-subtle`   | `#64748B` | Secondary text and metadata.                                    |
| White `canvas`           | `#FFFFFF` | Content surfaces: results, cards, forms.                        |

The full scales are in `packages/ui/src/theme.css`. Supporting shades follow these contrast
rules (WCAG 2.2 AA):

| Use                                           | Token                             | Contrast                      |
| --------------------------------------------- | --------------------------------- | ----------------------------- |
| Navy text on the primary gold button          | `navy-950` on `gold-400`          | 9.3 : 1                       |
| Gold text and accents on navy                 | `gold-300` / `gold-400` on navy   | ≥ 7.9 : 1                     |
| Gold text on white or `gold-50`               | `gold-700` / `gold-800`           | ≥ 5.5 : 1                     |
| Focus rings and non-text marks on any surface | `gold-600` (`--color-focus`)      | 3.65 : 1 white, 4.55 : 1 navy |
| Secondary text                                | `ink-subtle` on white / `surface` | 4.76 / 4.55 : 1               |

**Never set Warm Gold (`gold-200` to `gold-500`) as text on a light surface.** It measures
1.8 : 1 on white. On light backgrounds, the logo's gold blade uses a deeper `#C48A3C`.

### Navy and gold in practice

- Navy carries the premium brand: headers of inner pages, the footer, the hero, and selected
  states.
- Gold is selective. Use it for one key action per view (the `primary` button), eyebrow labels
  on navy, active-navigation markers, and the horizon line. If gold is everywhere, it no longer
  marks anything.
- Keep booking-critical screens (search results, details, review) on white and Soft White.
  The interface should never become entirely dark.

## Typography

| Role             | Typeface                                | Notes                                              |
| ---------------- | --------------------------------------- | -------------------------------------------------- |
| Display/headings | **Manrope** (`--font-display`)          | Same family as the wordmark; bold, tight tracking. |
| Text and UI      | **Inter** (`--font-sans`)               | Body, forms, prices, and tabular data.             |
| Eyebrows         | Inter Bold, uppercase, tracking 0.16 em | `gold-300` on navy, `gold-700` on light.           |

Both fonts are loaded with `next/font/google` and are licensed under the SIL Open Font License.

## Buttons and accents

| Variant     | Look                        | When                                                      |
| ----------- | --------------------------- | --------------------------------------------------------- |
| `primary`   | Warm Gold, navy text        | The single main action: Search flights, Select, Continue. |
| `secondary` | Deep Navy, white text       | Strong secondary actions (Try again, Done).               |
| `outline`   | White, `line-strong` border | Neutral actions (Explore all destinations, Edit search).  |
| `inverse`   | White on navy               | Actions placed on navy surfaces.                          |

Badges use `tone="gold"` for promotions and indicative prices, and `navy`/`neutral` for
everything else. The **horizon line** (a thin gold curve or rule) is the one decorative motif.
It appears at the base of the hero, at the top of the footer, and on the social card. Use it
sparingly.

## Voice

Warm, clear, and calm. Use "Velasia Airways" on first mention and in legal or fictional
disclaimers, and "Velasia" after that. The tagline is always written **Beyond every horizon.**
in sentence case, with the full stop. Use the title-case form only in the document title.

## Regenerating assets

All SVGs, PNGs, and the React logo geometry come from one script:

```bash
npm i --prefix /tmp/velasia-brand opentype.js@1.3.4 @fontsource/manrope@5.1.1 sharp@0.34.5
BRAND_DEPS=/tmp/velasia-brand node scripts/brand/generate-brand-assets.mjs
```

Change the identity there, never by hand-editing a generated file.
`apps/web/test/brand.test.ts` checks that the assets are valid.

The mark was designed as an original geometric construction for this demo. It has not been
through a trademark search, so do not use it outside this fictional project.
