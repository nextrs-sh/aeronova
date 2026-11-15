# Velasia Airways brand guidelines

**Beyond every horizon.**

Velasia Airways is a fictional, modern, premium full-service airline from the Philippines. The
brand should feel elegant, reliable, contemporary, welcoming, and international. These guidelines
cover what you need to use the identity correctly in this project.

> Velasia Airways is fictional. Do not present it, or these assets, as a real airline.

## Logo

![Velasia Airways logo](../apps/web/public/brand/velasia-logo.svg)

**The symbol** is two swept wing blades forming a V. Both blades stand on one shared, flat base:
the horizon. The leading blade is navy and tapers towards the horizon. The trailing blade is
Velasia Crimson and climbs past the top of the frame. This is the brand's forward motion, and the idea behind the
line "beyond every horizon". The symbol is recognisable without the wordmark.

**The wordmark** is VELASIA in Manrope SemiBold, tracked +150, set over AIRWAYS in Manrope
Medium. AIRWAYS is spaced out so its width matches VELASIA exactly. Both are converted to
outlines, so the logo never depends on a font being installed.

### Variations

| File (in `apps/web/public/brand/`) | Use it for                                                       |
| ---------------------------------- | ---------------------------------------------------------------- |
| `velasia-logo.svg`                 | **Primary.** Full colour, on white and light surfaces.           |
| `velasia-logo-dark.svg`            | Reversed (white + `crimson-400`), on navy, dark, or photo areas. |
| `velasia-logo-light.svg`           | One colour, navy, on light surfaces when crimson is unavailable. |
| `velasia-wordmark.svg`             | Wordmark only, where the symbol already appears nearby.          |
| `velasia-symbol.svg`               | Symbol only: avatars, app tiles, small brand marks.              |
| `velasia-favicon.svg`              | Browser tab icon (symbol reversed on a Midnight Navy tile).      |
| `velasia-apple-touch-icon.png`     | 180 × 180 home-screen icon (full bleed; iOS rounds the corners). |
| `velasia-icon-512.png`             | 512 × 512 web-app manifest icon.                                 |
| `velasia-social-preview.png`       | 1200 × 630 Open Graph and Twitter card.                          |

In the app, use the `Logo` and `LogoMark` components (`apps/web/src/components/brand/logo.tsx`).
Use `tone="default"` on light surfaces and `tone="inverse"` on navy. Both components are
decorative (`aria-hidden`), so always wrap them in a labelled element, for example
`<Link aria-label="Velasia Airways home">`.

### Clear space and minimum size

- **Clear space:** keep a margin of at least the height of the symbol's crimson blade tip around
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

Velasia Crimson is the primary brand colour. It marks the actions and states that matter: the
primary button, active navigation, selected options, and progress. Navy carries the premium
surfaces, and white and Soft White carry content.

| Token                             | Hex       | Role                                                       |
| --------------------------------- | --------- | ---------------------------------------------------------- |
| Primary `primary` (`crimson-600`) | `#B42332` | Brand colour, primary buttons, links, selected states.     |
| Primary hover `primary-hover`     | `#961E2B` | Hover on crimson buttons and links.                        |
| Primary active `primary-active`   | `#851827` | Pressed state.                                             |
| Primary subtle `primary-subtle`   | `#FFF4F3` | Selected-card backgrounds, subtle highlights.              |
| Primary border `primary-border`   | `#F0C5C9` | Soft branded borders (primary badges).                     |
| Foreground `ink`                  | `#243047` | Primary text.                                              |
| Muted foreground `ink-subtle`     | `#64748B` | Secondary text and metadata.                               |
| Background `canvas`               | `#FFFFFF` | Content surfaces: results, cards, forms.                   |
| Surface `surface`                 | `#F8FAFC` | Section backgrounds and quiet panels.                      |
| Border `line`                     | `#E2E8F0` | Neutral borders.                                           |
| Midnight Navy `navy-950`          | `#101E38` | Premium surfaces: hero, page headers, footer, demo notice. |
| Ring `focus` (`crimson-500`)      | `#DC5566` | Keyboard focus rings.                                      |
| Danger `danger`                   | `#C0360F` | Errors only. Deliberately warmer than crimson.             |

The full scales and the semantic aliases (`background`, `foreground`, `muted`,
`muted-foreground`, `border`, `ring`, `accent`) are in `packages/ui/src/theme.css`. Components
use the semantic `primary-*` tokens, not the `crimson-*` scale. Contrast (WCAG 2.2 AA):

| Use                                    | Token                                    | Contrast                 |
| -------------------------------------- | ---------------------------------------- | ------------------------ |
| White text on primary / hover / active | `primary-foreground` on `primary-*`      | 6.5 / 8.3 / 9.7 : 1      |
| Crimson text on light surfaces         | `primary` on white / `surface` / subtle  | 6.5 / 6.2 / 6.0 : 1      |
| Small crimson text on navy (eyebrows)  | `primary-on-dark` (`crimson-200`)        | ≥ 9.2 : 1                |
| Large text and marks on navy           | `primary-accent-on-dark` (`crimson-400`) | ≥ 4.7 : 1                |
| Focus rings on any surface             | `focus` (`crimson-500`)                  | ≥ 3.3 : 1 (white & navy) |
| Error text                             | `danger` on white / `danger-surface`     | 5.6 / 5.0 : 1            |
| Body / secondary text                  | `ink` / `ink-subtle` on white            | 13.2 / 4.76 : 1          |

**Never set `crimson-600` on navy** (2.6 : 1). Use the `-on-dark` tokens there. Never set
`crimson-200`–`500` as text on a light surface.

### Crimson, navy, and attention colours in practice

- Crimson is selective. Use it for one key action per view (the `primary` button), links,
  active navigation, selected cards and chips, and progress. Never fill large areas with it: no
  crimson heroes, sections, or page backgrounds.
- Selected states never rely on colour alone. Pair crimson with a ring, a check icon, a
  "Your choice" badge, `aria-pressed`/`aria-current`, or a filled marker.
- Navy carries premium surfaces (hero, inner-page headers, footer) and strong `secondary`
  buttons. Text inputs keep a navy focus border, so crimson is never mistaken for an error.
- **Errors are red-orange (`danger`), not crimson,** and always come with an icon and text.
- **Gold is no longer a brand colour.** It remains only as the semantic attention palette: price
  changes, price holds and timers, layovers and next-day arrivals, fees, low-seat warnings,
  demo notices, and the Preferred seat class. Never use it for actions, navigation, or
  selection.
- Keep booking-critical screens (search results, details, review) on white and Soft White.

## Typography

| Role             | Typeface                                | Notes                                              |
| ---------------- | --------------------------------------- | -------------------------------------------------- |
| Display/headings | **Manrope** (`--font-display`)          | Same family as the wordmark; bold, tight tracking. |
| Text and UI      | **Inter** (`--font-sans`)               | Body, forms, prices, and tabular data.             |
| Eyebrows         | Inter Bold, uppercase, tracking 0.16 em | `primary-on-dark` on navy, `primary` on light.     |

Both fonts are loaded with `next/font/google` and are licensed under the SIL Open Font License.

## Buttons and accents

| Variant     | Look                        | When                                                      |
| ----------- | --------------------------- | --------------------------------------------------------- |
| `primary`   | Crimson, white text         | The single main action: Search flights, Select, Continue. |
| `secondary` | Deep Navy, white text       | Strong secondary actions (Try again, Done).               |
| `outline`   | White, `line-strong` border | Neutral actions (Explore all destinations, Edit search).  |
| `inverse`   | White on navy               | Actions placed on navy surfaces.                          |

Badges use `tone="primary"` for promotions and the chosen fare, `tone="gold"` only for attention
states (price changed, hold ended), and `navy`/`neutral` for everything else. The **horizon line**
(a thin `primary-accent-on-dark` curve or rule) is the one decorative motif.
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
