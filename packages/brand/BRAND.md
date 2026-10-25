# uier brand guidelines

This file is the written source of truth for how uier looks and sounds. The values it describes
are implemented in this package (`tokens.css`, `src/brand.ts`, `src/Mark.tsx`, `src/Logo.tsx`,
`assets/`) and rendered live at [uier.io/brand](https://uier.io/brand) (`apps/web/app/brand`).
If the page and this file disagree, the page shows what actually ships; fix whichever is wrong.

The original design exploration is a Claude Design canvas (private, October 2026):
https://claude.ai/artifact/DohaREd1MWr6XhE8ibssJN. It is an archive, not a reference: everything
that matters from it is here.

## What uier is

uier lets you review a live website by leaving comments directly on the page. A toolbar is
injected into the page, comments are pinned to elements or to selected text, and they are stored
per domain. The brand follows the product: **quiet, precise, rounded, and a little pointed**.

Three principles decide most questions:

- **Minimal.** One typeface, one accent, borders instead of shadows. Nothing on screen that is
  not doing work. The references are vercel.com, linear.app and signalco.io.
- **Rounded.** Every corner is soft. Radius grows with the surface: 8 px on controls, 12 on
  cards, 16 on panels, full pills for the toolbar, pins, avatars and badges.
- **Pointed.** The mark keeps one sharp corner so it can point at what you are reviewing. Copy
  is short and direct.

## Name

- The name is **uier**, always lowercase: in headings, at the start of a sentence, in the
  wordmark, in the manifest. Never "Uier", never "UIER".
- It is read "you-eye-er".
- In running text it gets no special styling: same weight and colour as the words around it.
- The domain is uier.io. uier is a signalco project (signalco.io); say so in the footer, not in
  the logo.

## Tagline and voice

- Tagline: **Say it on the page.**
- One-line description: *Review any live website by leaving comments directly on it.*
- Longer: *Review any live website by leaving comments directly on it. Every comment stays
  pinned to the element it is about, with the browser and viewport it was left from.*
- Pricing promise (`brand.pricing`), word for word wherever pricing comes up: *Every feature
  available today is free and will stay free forever. If we introduce pricing, it will apply only to
  new features users want.* Never show prices, tiers, trials or limits that do not exist.
- Sentence case everywhere. No Title Case headings, no ALL CAPS labels, no exclamation marks.
- Short sentences, concrete nouns. Say what happens ("The comment stays attached to that
  element"), not how it feels ("seamless", "powerful", "delightful").
- Only claim what the product does. Do not invent stats, customers or features.

## Logo

### The mark is a pin

A 1:1 square with three corners at full radius and the **top-left corner left sharp**. The sharp
corner is the pointer: in the product it sits where a comment is anchored, so the logo is the
same shape people click on every day.

- Path on a 24-unit grid: `M0 0h12a12 12 0 0 1 12 12a12 12 0 0 1-12 12a12 12 0 0 1-12-12z`
  (`MARK_PATH` in `src/brand.ts`, `<Mark />` in `src/Mark.tsx`).
- One colour, no gradient, no outline, no shadow. Ink (#0A0A0A) on light, white on dark.
- Never rotate or flip it: the sharp corner points up-left.
- The product pin is the same shape on a 32 grid with a 2 px white ring and the thread count
  inside (`PIN_PATH`); that is the only place the mark gets a ring.

### The wordmark is just the name

"uier" in Geist Semibold (600) with −3 % letter-spacing, lowercase. Four letters without
ascenders make a compact, level shape that sits naturally next to the pin.

### Lockups

`<Logo />` renders the horizontal lockup; `<Logo markOnly />` the mark alone.

| | Rule |
| --- | --- |
| Mark : wordmark | mark height = 0.8 × wordmark font size (about cap height × 1.1) |
| Gap | 0.4 × wordmark font size |
| Clear space | 0.5 × mark height on every side |
| Minimum size | mark 16 px; lockup 20 px tall |
| Stacked | mark centred above the wordmark, gap 0.4 × font size; use only where width is tight |

Do not: capitalise the name, recolour the mark or wordmark, rotate or flip the mark, add an
outline, shadow or gradient, or put a tagline or descriptor inside the lockup.

## Colour

Ink on paper. Neutral greys with no blue cast. Dark mode is true black, like the toolbar.
Contrast ratios are against the mode's background.

### Light

| Token | Hex | Role | Contrast |
| --- | --- | --- | --- |
| Paper | `#FFFFFF` | background | |
| Ink 50 | `#FAFAFA` | hover rows | |
| Ink 100 | `#F5F5F5` | muted surface | |
| Ink 200 | `#E5E5E5` | border, divider | |
| Ink 300 | `#D4D4D4` | quote bar, disabled text | |
| Ink 500 | `#707070` | muted text (also 4.6 on Ink 100) | 5.0 |
| Ink 700 | `#404040` | secondary text | 10.4 |
| Ink 950 | `#0A0A0A` | text, primary fills | 19.6 |

### Dark

| Token | Hex | Role | Contrast |
| --- | --- | --- | --- |
| Black | `#000000` | background | |
| Surface | `#0A0A0A` | card | |
| Elevated | `#171717` | menu, popover, input | |
| Border | `#262626` | border, divider | |
| Muted | `#A3A3A3` | muted text | 8.3 |
| Secondary | `#D4D4D4` | secondary text | 14.1 |
| Text | `#EDEDED` | text | 17.6 |
| White | `#FFFFFF` | primary fills | 21 |

### Accent and semantic

| Colour | Hex | Use |
| --- | --- | --- |
| Blue | `#2E5BFF` | the one accent (white text on it: 5.2). As text on dark use `#7A9BFF` (8.0). |
| Green | `#15803D` | resolved, success (`#22C55E` as a dot on dark) |
| Amber | `#B45309` | warning |
| Red | `#DC2626` | destructive |

**Where blue shows up:** a selected text range (20 % tint), a focused control (2 px ring at
2 px offset, keyboard only), an unread count, a link. **Primary buttons and pins stay ink.**
Blue is never a background for a section, a card or a button.

### Theme tokens

`tokens.css` overrides the signalco minimal theme (`--foreground`, `--border`, `--muted`,
`--ring`, `--radius`, ...) and adds `--brand-accent`, `--brand-accent-text`,
`--brand-selection`, `--brand-success` and `--brand-warning`, plus the app's sidebar
(`--sidebar`: Ink 100 on light, Surface on dark; `--sidebar-accent`: Ink 200 / Border for hover
and the current item). Components use the semantic classes (`text-muted-foreground`,
`border-border`, `bg-primary`, `bg-sidebar`) or these variables.
A raw hex belongs only in `src/brand.ts`, for metadata and generated images.

## Typography

**Geist for everything. Geist Mono for what a machine wrote.** The web app loads both with
`next/font` from the `geist` package (`--font-geist-sans`, `--font-geist-mono`); the toolbar
injects the Google Fonts stylesheet into the reviewed page and falls back to `system-ui`.

| Style | Size / line | Tracking | Weight |
| --- | --- | --- | --- |
| display | 64 / 64 | −4 % | 600 |
| h1 | 40 / 44 | −3 % | 600 |
| h2 | 28 / 34 | −2 % | 600 |
| h3 | 20 / 26 | −1.5 % | 600 |
| body | 16 / 26 | 0 | 400 |
| small | 14 / 21 | 0 | 400 |
| caption | 12 / 17 | 0 | 500 |
| mono | 13 / 20 | 0 | 400 |

- Tight up top, loose below: negative tracking from display down to h3, none at 16 px and under.
- Three weights: 400 for reading, 500 for labels and buttons, 600 for headings. 700 is never used.
- Counts, times and lists use tabular figures (`font-variant-numeric: tabular-nums`).
- Mono means machine: domains, paths, timestamps, IDs, keyboard shortcuts. Never for emphasis.
- Stacks: `Geist, system-ui, -apple-system, "Segoe UI", sans-serif` and
  `"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace`.

## Shape, space and motion

### Radius

| px | Use |
| --- | --- |
| 4 | checkbox, tag |
| 6 | small button, menu item |
| 8 | button, input |
| 10 | large button (`--radius`) |
| 12 | card, menu, popover |
| 16 | sidebar, dialog, section tile |
| 24 | browser frame, hero media |
| full | toolbar, pin, avatar, badge, toggle |

With the UI kit: `rounded-sm` = 6, `rounded-md` = 8, `rounded-lg` = 10 (`--radius`),
`rounded-xl` = 12, `rounded-2xl` = 16, `rounded-3xl` = 24, `rounded-full`.

### Space

4 px grid: 4 icon-to-label, 8 inside a pill and between buttons, 12 list rows and menu padding,
16 card and popover padding, 24 between cards and dialog padding, 32 section inner padding,
64 between marketing sections. Controls are 32 (sm), 36 (md) or 44 (lg) tall; touch targets
never below 44.

### Borders and elevation

Two levels only.

- **Resting:** 1 px border (Ink 200 / `#262626`), no shadow. Cards, inputs, sections, tables.
- **Floating:** border plus `0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.08)`. Toolbar,
  popovers, menus, dialogs. On dark a 1 px `#262626` ring does the lifting.

### Icons

Lucide (the UI kit's `@signalco/ui-icons`), 1.75 px stroke, 16 inline with text, 20 in buttons,
24 in the toolbar. Outlined only; the pin is the one filled shape.

### Motion

150 ms ease-out enter and exit (fade plus 8 px slide, as the sidebar does), 120 ms colour-only
hover and press, nothing on page load. No bounces, parallax or gradient movement.

## The review layer

The toolbar, pins and inbox sidebar are what the product *is*, and they follow two rules:

1. **The review layer is always ink.** The pill toolbar, the pins and the sidebar stay black on
   any site they land on; they never try to match the host page.
2. **Threads follow the system theme.** The comment popover is paper in light mode and surface
   black in dark mode, because people read and type in it.

A pin is the mark on a 32 grid, ink fill, 2 px white ring, the thread count in white 600 inside.
A commented text range gets the blue 20 % tint. The inbox shows the unread count as a blue pill.

## Components

Public pages use `@signalco/ui` and `@signalco/ui-primitives`; the signed-in app uses the
shadcn/ui components in `apps/web/src/components/ui`. Both run on these tokens; do not build
parallel components. The app is a sidebar (one step off the page colour) beside an inset panel
with a 1 px border. Solid buttons are ink (white on dark), outlined buttons are the border, plain
buttons are nothing until hovered. Inputs are bordered, 36 px, radius 8, blue focus ring.
Badges are full-radius with a 6 px status dot (ink = open, green = resolved). Menus and
popovers are radius 12 and float; dialogs and the sidebar are radius 16.

## Marketing and metadata

- Hero: the tagline as the display line, the longer description under it, one solid "Get
  started" and one outlined secondary action. No pills or badges above the headline.
- Show the product by putting the review layer on the page itself (a pinned thread on the
  headline, the toolbar at the bottom) rather than a screenshot in a fake browser.
- Footer: on every page, with "A signalco project" in the bottom line. Contact and social links
  use `brand.contact` and `brand.social`; uier has no mailboxes or social accounts of its own, so
  they are signalco's (contact@signalco.io, @signalco_io on X) and the GitHub repository.
- Social card (1200 × 630): paper background, lockup, tagline, uier.io in mono, the pin and
  toolbar as a motif. Generated by `apps/web/app/opengraph-image.tsx` from `brand.ts`.
- App icon: black plate, radius 22 % of the side, white mark at 54 % nudged 1.5 % down and
  right. Exported square (platforms apply their own masks). Favicon: the bare mark, ink in
  light tabs and white in dark through a `prefers-color-scheme` rule in `assets/favicon.svg`.
  PNG fallbacks come from `pnpm -C packages/brand icons`.
- Manifest and browser UI colour: `#FFFFFF` light, `#000000` dark.

## Changing the brand

1. Change the value in this package (`tokens.css` for colour and radius, `src/brand.ts` for
   names, copy and hex mirrors, `src/Mark.tsx` for the shape).
2. Update this file so the rule matches the value.
3. Re-render icons if the mark changed (`pnpm -C packages/brand icons`) and commit them.
4. Check [uier.io/brand](https://uier.io/brand) (or `/brand` locally): it renders from the same
   code, so it shows the change as it ships.
