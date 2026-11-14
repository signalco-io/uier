# The reviewed page's styles

The toolbar looks the same on every site: the same font, sizes, spacing, icons, line height and colours,
whatever the reviewed page's CSS does (uier #440). What the person chose in their browser still applies:
their zoom, their default font size, reduced motion, the colour scheme and forced colours.

A shadow root keeps the page's selectors out, but not everything. These are the ways the page's styles reach
the toolbar, and what keeps each one out.

| Way in | Example | Kept out by |
| --- | --- | --- |
| Inherited properties cross the shadow boundary | `body { font: 22px/3 serif; letter-spacing: 4px; text-transform: uppercase; -webkit-text-fill-color: red }` | `[data-uier-root] { all: initial }`, then the toolbar's own text styles (`src/styles/toolbar-theme.css`) |
| The page's rules match the host element itself | `body > div { transform: translateZ(0); zoom: 1.5; content-visibility: auto }`, `#uier-toolbar { opacity: .6 !important }` | `:host(:where(#uier-toolbar)) { all: initial !important; display: block !important }`: a shadow tree's `!important` `:host` rule wins over every page declaration, `!important` and inline ones too |
| `rem` is the page's root font size, also in a shadow tree | `html { font-size: 62.5% }` | Every `rem` in a declaration becomes `calc(<n> * var(--uier-rem, 1rem))` (`shadowRootIsolation.mjs`, after Tailwind) |
| The UI kit writes `rem` into inline styles | `Row` and `Stack` set `--s-gap: <spacing / 2>rem` | The same unit, rewritten in the kit's code when the review bundle and the extension are built (`uiKitInlineRem`); the build fails if a bundle still writes one |
| Custom properties set on the host win over the theme's `:host` rules | `* { --spacing: 1px; --radius: 0; --foreground: … }` | The `:host` rules (Tailwind's theme, the brand tokens, the preflight) apply to `[data-uier-root]` too |
| Custom properties the toolbar reads but never declares inherit the page's | `:root { --width: 900px }` | `[data-uier-root]` sets each one to `initial`, a list the build makes; not `--font-geist-sans`, which is how uier.io's own Geist reaches the toolbar |
| The page's CSS `zoom` on `<html>`, `<body>` or a layer the host is in | `html { zoom: 1.25 }` | `src/pageZoom.ts` gives the host the inverse (its parent's `currentCSSZoom`), so the toolbar is drawn at 1 and its fixed boxes stay at the page coordinates it measures |
| The page's direction and language | `<html dir="rtl" lang="ja">` | `direction: ltr` and the root's `dir` (the six languages are left to right), its `lang` from the toolbar's language ([languages](localization.md)) |
| The page's `::selection` | `::selection { background: magenta }` | Nothing more needed: the UI kit's theme sets the toolbar's own selection colours on every element |

## `--uier-rem`

- It is the person's default font size, the browser's setting: `prepareToolbarRoot` (`src/stylesheet.ts`)
  reads the root's own size, `medium`, which a page's styles do not change, once the root is in the document.
  Until then, and if that fails, it is 16 px. Media queries keep `rem`: there it already is the browser's
  default size, not the page's.
- Write sizes as Tailwind classes (`p-2`, `text-sm`, `w-[min(36rem,…)]`) or px: the build turns their `rem`.
  Never write `rem` into an inline style or a custom property from code; the review build fails when one does.

## Rules

- `[data-uier-root]` is the boundary for the toolbar's root and an inline thread's
  (`components/InlineCommentThread.tsx`): every text style the toolbar needs is set on it after `all: initial`
  (font, size, line height, colour, `-webkit-font-smoothing: antialiased` as on uier.io, `text-size-adjust`,
  `pointer-events: auto` against a modal's `body { pointer-events: none }`). Add a property there, not on the
  host, when it has to be the same everywhere.
- The host reset is only for the toolbar's own host. An inline thread's slot is the page's own element, laid out
  by the page; its root still resets what it inherits. `:where` keeps the reset below `:host([popover])`, the host
  in a page layer ([page layers](../AGENTS.md#how-it-is-built)).
- The page's zoom is undone only for the toolbar's host: an inline thread is part of the page's layout and zooms with it.
  The zoom sheet is adopted only once a page zooms, and updates on resize, on `class` and `style` changes of
  `<html>` and `<body>`, and when the host moves into or out of a page layer (`matchPageZoom` in `src/modalLayer.ts`).
- Reduced motion, colour scheme and forced colours are media features of the person's settings, not of the page:
  `all: initial` gives `forced-color-adjust: auto` back even when the page turned it off for itself.

## Tests

`apps/web/e2e/host-styles.spec.ts` opens a project's page plain and with styles that reach the toolbar every way
above (`fixture-host-styles`, `e2e/support/fixtures/hostStyles.ts`), and expects the pill and the Profile popover
to have the same boxes, text styles and selection colours, and point mode to outline the page's heading where it
is, inside the page's zoom. `e2e/embed.spec.ts` checks the other direction: the toolbar leaves the page's styles alone.
