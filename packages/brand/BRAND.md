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
- The product pin is the same shape on a 32 grid with a 2 px white ring and the issue number
  inside (`PIN_PATH`); that is the only place the mark gets a ring.
- The product pin is the one exception to "never flip": where the bottom of the window leaves no room below
  the anchor, the pin sits above the point it marks, upside down (`<Pin upsideDown />`), its sharp
  corner pointing down-left at it. The number and the message badge stay upright.

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
| Green | `#15803D` | resolved, success, the Done status, an open pull request (`#22C55E` as a dot on dark) |
| Sky | `#0284C5` | the In progress status (`#3ABFF8` on dark) |
| Violet | `#7C3BED` | the Ready to verify status, a merged pull request (`#A689FA` on dark) |
| Amber | `#B45309` | warning, High priority |
| Red | `#DC2626` | destructive, Urgent priority, a critical accessibility issue, a closed pull request |

**Where blue shows up:** a selected text range (20 % tint), a focused control (2 px ring at
2 px offset, keyboard only), an unread count, a link. **Primary buttons and pins stay ink.**
Blue is never a background for a section, a card or a button.

**Priority** is a flag (Lucide's outlined `Flag`) in the priority's colour, always beside its name, so
colour is never the only signal: Low muted grey (`--muted-foreground`), Normal ink (`--foreground`),
High amber (`--brand-warning`), Urgent red (`--destructive`). Lists and boards show it only for a
priority other than Normal, so the threads that differ stand out. Priority has no tokens of its own.

**Accessibility impact** (the toolbar's Accessibility panel) uses the priority colours, each with an
outlined shape of its own beside its name, so colour is never the only signal: Critical red
(`--destructive`, octagon alert), Serious amber (`--brand-warning`, triangle alert), Moderate ink
(`--foreground`, circle alert), Minor muted grey (`--muted-foreground`, info). The SEO panel's checks
are a green check (`--brand-success`) for a pass, an amber triangle for what is worth a look and a muted
info for a note. A summary tile's icon takes its colour only while its count is above 0. Impact has no
tokens of its own. While the background check of the page found something to act on, the pill's
Accessibility or SEO button carries a small amber dot (`--brand-warning`), never blue (blue is unread),
and its name says what was found.

**Status** is a 6 px dot in the status's colour, always beside its name: Open an outlined ink ring
(`--foreground`, 1 px, not filled), In progress sky (`--brand-in-progress`), Ready to verify violet
(`--brand-ready`), Done green (`--brand-success`). The same dot shows on list rows, board column headers, the status menu, the
Status filter and the toolbar's thread. Sky and violet are status colours only: they are not the
accent, so a status never reads as unread or a link, and they stay clear of the priority flags'
amber and red. Each dot or ring is at least 3:1 against its surface in both modes.

**Pull request state** uses the same badge, coloured like GitHub's states: Open green
(`--brand-success`), Merged violet (`--brand-ready`), Closed red (`--destructive`), Draft muted grey
(`--muted-foreground`). It is the one other place violet appears; it is still a state, never the accent.

### Theme tokens

`tokens.css` overrides the signalco minimal theme (`--foreground`, `--border`, `--muted`,
`--ring`, `--radius`, ...) and adds `--brand-accent`, `--brand-accent-text`,
`--brand-selection`, `--brand-success`, `--brand-warning`, `--brand-in-progress` and `--brand-ready`, plus the app's sidebar
(`--sidebar`: Ink 100 on light, Surface on dark; `--sidebar-accent`: Ink 200 / Border for hover
and the current item). Components use the semantic classes (`text-muted-foreground`,
`border-border`, `bg-primary`, `bg-sidebar`) or these variables.
A raw hex belongs only in `src/brand.ts`, for metadata and generated images. The exceptions in
the product are the provider marks on the sign-in card, Google's "G" and Microsoft's logo in their
own colours ([Google sign-in](../../docs/google-sign-in.md)); the buttons around them are the same
outline button as every other sign-in option. The others are the
logos of connected services in a project's Integrations settings: each is the provider's own filled
mark on a bordered tile, in ink and paper where the provider allows a one-colour logo (GitHub,
Linear, Notion) and in its own colours where it does not (Slack, Azure DevOps). The AI agents that
work under an assignee (Claude, Codex, ChatGPT, Cursor) show their product's one-colour mark in ink and
paper on a bordered circle, as do the connected apps and access tokens in Account → Coding agents; in
compact assignment groups they are small badges on their person's avatar edge. People remain separate groups, and hover cards indent smaller agent avatars beneath
their person. A generic agent is Lucide's bot.
They are third-party marks: never recoloured, redrawn or used as uier's.

## Typography

**Geist for everything. Geist Mono for what a machine wrote.** The web app loads both with
`next/font` from the `geist` package (`--font-geist-sans`, `--font-geist-mono`); the toolbar
loads the Geist stylesheet and font files from its configured uier API origin into the reviewed
page and falls back to `system-ui`. Font files come from the web app’s pinned `geist` package;
reviewing never contacts Google Fonts.

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

4 px grid: 4 icon-to-label in text, 8 inside a pill, between buttons and icon-to-label in menu and option rows,
12 list rows and menu padding,
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

150 ms ease-out enter and exit (fade plus 8 px slide, as the sidebar does), 200 ms ease-out for
an item that changes place (a card to another column, a row to its new order), 120 ms colour-only
hover and press, nothing on page load. No bounces, parallax or gradient movement.

## The review layer

The toolbar, pins and inbox sidebar are what the product *is*, and they follow two rules:

1. **The review layer is always ink.** The pill toolbar, the pins and the sidebar stay black on
   any site they land on; they never try to match the host page.
2. **Threads follow the system theme.** The comment popover is paper in light mode and surface
   black in dark mode, because people read and type in it.

A pin is the mark on a 32 grid, ink fill, 2 px white ring, the issue number in white 600 inside:
the same `#12` the thread, the inbox and the app show, so a pin people mention can always be found.
It never changes when replies come in. From the first reply, the message count sits on the top-right
corner as a small white badge with ink text and outline, so it never reads as the number. Three or
more digits get a smaller size to stay inside the pin. The pin's name says both: "Comment #12, 3 messages".
A commented text range gets the blue 20 % tint. A commented area gets a dashed blue outline, with
the same tint while its thread is open. The inbox shows the unread count as a blue pill.

## Components

Public pages use `@signalco/ui` and `@signalco/ui-primitives`; the signed-in app uses the
shadcn/ui components in `apps/web/src/components/ui`. Both run on these tokens; do not build
parallel components. The app is a sidebar (one step off the page colour) beside an inset panel
with a 1 px border. Solid buttons are ink (white on dark), outlined buttons are the border, plain
buttons are nothing until hovered. Inputs are bordered, 36 px, radius 8, blue focus ring.
Badges are full-radius with a 6 px status dot in the status's colour (see Status above). Menus and
popovers are radius 12 and float; dialogs and the sidebar are radius 16.

## Marketing and metadata

- Hero: the tagline as the display line, the one-line description (`brand.shortDescription`)
  under it, one solid "Get started" and one outlined secondary action. No pills or badges above the headline. The cover
  beside it is the how-it-works scene: the product playing on an example site in a browser frame
  (radius 24, hero media), built from the tokens, never a screenshot.
- Show the product by putting the review layer on the page itself (a pinned thread on the
  headline, the toolbar at the bottom) rather than a screenshot in a fake browser. Where a
  section needs a picture, use a small static piece of the product built from the tokens (a pin,
  a thread, the ink inbox), not a screenshot; the example content is an imaginary site.
- Navigation: the section links, then one solid "Sign in" that opens the app. "Get started"
  opens the app too.
- Page headers: the title and one short sentence. Sections are separated by whitespace (64 px
  and more), not rules; on wide screens a section's heading stays in view beside its content
  (the landing's questions, the content pages), unless the content needs the full width. Related
  items sit in one bordered panel divided by hairlines rather than in a row of separate cards. Keep steps and
  tiles to a title and one or two short sentences, and do not give two neighbouring sections the
  same layout.
- At most one thing moves on its own: the landing's cover, the how-it-works scene, a loop that
  plays the product on an example site. Things in it come and go with the enter and exit motion above; the
  pointer and the text selection move with ease-out and no overshoot. It plays only in view, has a
  Pause button and shows one still frame with reduced motion.
- Footer: on every page, with "A signalco project" in the bottom line. Contact and social links
  use `brand.contact` and `brand.social`; uier has no mailboxes or social accounts of its own, so
  they are signalco's (contact@signalco.io, @signalco_io on X) and the GitHub repository.
- Social card (1200 × 630): paper background, lockup, tagline, uier.io in mono, the pin and
  toolbar as a motif. Generated by `apps/web/app/opengraph-image.tsx` from `brand.ts`. Public
  pages get the same card with their title, description and address (an integration's adds the
  service's logo on a bordered tile). Links into the app (a comment, a review link, an invitation,
  sign in) get the lockup and the kind of link beside a static piece of the review layer with
  placeholder bars, never real or example words. All are drawn by `apps/web/src/lib/social`.
- App icon: black plate, radius 22 % of the side, white mark at 54 % nudged 1.5 % down and
  right. Exported square (platforms apply their own masks). Browsers do not mask extension
  icons, so the extension's 16/32/48 px icons draw the 22 % radius in, and its 128 px store icon
  keeps the Chrome Web Store's 16 px of transparent padding around a 96 px plate (rendered by the
  extension build from `MARK_PATH`). Favicon: the bare mark, ink in
  light tabs and white in dark through a `prefers-color-scheme` rule in `assets/favicon.svg`.
  PNG fallbacks come from `pnpm -C packages/brand icons`.
- Manifest and browser UI colour: `#FFFFFF` light, `#000000` dark.
- Email (`apps/web/src/lib/email/templates.ts`): a paper card (radius 16, 1 px Ink 200 border) on
  an Ink 100 page, the app icon at 32 px, an h3 heading, body text in Ink 700, one solid ink
  button and the small print under a hairline. A sign-in code is Geist Mono in a muted box.
  Dark mode follows the app: black page, Surface card, `#262626` borders, a white button, blue
  links in `#7A9BFF`. Clients that recolour emails themselves get ink on paper, which inverts
  cleanly. No web fonts and no tracking: the icon is the only image.

## Changing the brand

1. Change the value in this package (`tokens.css` for colour and radius, `src/brand.ts` for
   names, copy and hex mirrors, `src/Mark.tsx` for the shape).
2. Update this file so the rule matches the value.
3. Re-render icons if the mark changed (`pnpm -C packages/brand icons`) and commit them.
4. Check [uier.io/brand](https://uier.io/brand) (or `/brand` locally): it renders from the same
   code, so it shows the change as it ships.
