# Accessibility panel: alt text, zoom and text spacing, motion

Three sections of the Accessibility panel, after axe-core's audit, for what the audit cannot judge
([page checks](page-checks.md#sections)). They do not repeat it: images without alt text, alt text
that repeats its link's text, and `marquee` and `blink` elements are axe-core's rules above them.
The logic is in the audit asset (`src/checks/lazy/altText.ts`, `reflow.ts`, `motion.ts`), the views in
`components/checks/sections/AltTextSection.tsx`, `ReflowSection.tsx` and `MotionSection.tsx`. Issues
are `accessibility` checks with the ids below; their comments start with `Accessibility:`, name the
element and quote the page's text as code. A line every issue of a check shares (a single issue's) is
the check's value, since the panel then shows only the elements' names.

## Alt text

`altText` runs in the `background` (string work, a few milliseconds), so its flags count on the
Accessibility button; images added after it ran show after Check again.

- **The images**: `img`, `input[type=image]`, `area[href]` (outlined and pinned on the image that uses
  its map), `[role=img]` and an `svg` with a role, a label or a `<title>`; rendered, not inside
  `aria-hidden="true"`, not the toolbar's, and not inside the page's own shadow roots. Each row has a
  thumbnail, the text a screen reader reads (`aria-labelledby`, `aria-label`, `alt` or an svg's
  `<title>`, then `title`), its short name and Highlight. An empty `alt` on an `img` or a presentation
  role reads "Decorative", for a person to confirm; nothing reads "No alt text (in the audit above)".
  Eight rows, then "Show all".
- **Thumbnails** render only in the open panel: an `<img>` in the toolbar's shadow root from the
  address the page itself loaded (`currentSrc`; an image button's `src`), `loading="lazy"`,
  `referrerpolicy="no-referrer"`, an empty `alt`, 32 px. An inline svg, a `role="img"` element, an area,
  an image the page has not loaded yet (lazy, below the window) and an address that does not load get a
  neutral placeholder; nothing is copied from the page and nothing new is requested.
- **Flags**, each a warning with an issue on every image it applies to (`alt-text-file-name`,
  `alt-text-prefix`, `alt-text-placeholder`, `alt-text-long`): alt text that looks like a file name (an
  image extension at its end, camera names such as `IMG_1234` or `Screenshot 2024`, a hash, a UUID, a
  long token without spaces that has digits, or the image's own file name when that has digits, `-` or
  `_`); that starts with "image of", "picture of", "photo of", "graphic of", "image:" and the like; that
  is a placeholder word ("image", "photo", "alt", "untitled", "spacer", "icon", ...) or has no letters;
  or that is over 150 characters. "Logo" alone is fine. **The word lists are English**: alt text in
  another language is flagged only for file names, missing letters and length. Without flags, one row
  says none was found (`alt-text-wording`); a page without images says so (`alt-text-images`).

## Zoom and text spacing

- **Reflow** (`reflow`, WCAG 1.4.10, `panel`): at the width the page is laid out in (the document's
  `clientWidth`; not `innerWidth`, which on a phone grows with content wider than the screen), whether
  the page scrolls sideways (its `scrollWidth` beyond that, unless `html`/`body` clip it) and the
  elements whose right edge is beyond the document's width: the outermost of them, not inside a box
  whose `overflow-x` is not `visible` (a table, code or a carousel that scrolls or clips sideways on
  purpose), not fixed, not hidden (`visibility`, `opacity: 0`, no box), not the toolbar, and where the
  page clips instead of scrolling, not parked entirely beyond its edge (off-canvas). At most 20 are
  listed. The toolbar cannot resize the window, so the row says what it measured: "Checked at 1280 px.
  WCAG 1.4.10 asks for 320 px (1280 px at 400% zoom): narrow the window or zoom in, then check again";
  on a phone or tablet (a coarse pointer without hover) "Checked at 393 px, this screen's width"; at
  320 px or less, that it is within the width asked for. Nothing found is a pass only there; wider, a
  note. Content in the page's own shadow roots is not walked: a page that scrolls without a named
  element gets an issue about the page.
- **Text spacing** (`text-spacing`, WCAG 1.4.12, `manual`): **Apply text spacing** (`aria-pressed`)
  puts the criterion's values on the page (line height 1.5, paragraph spacing 2 em, letter spacing
  0.12 em, word spacing 0.16 em) and keeps them there while the reviewer looks. It measures every
  element's overflow before and two frames after, and lists (at most 20) boxes with text that fit it
  before and no longer do, whose text (a range over their content, not a paragraph's new margin) leaves
  the box: "Cut off" where the box clips (`overflow` hidden or clip), "Spills out" where a fixed size
  lets it overflow. Boxes that scroll keep their text in reach and are left out, as are marquees.
  - The spacing is a constructed stylesheet in `document.adoptedStyleSheets` (a site's CSP can block a
    `<style>` element or a `style` attribute, never this). Its selector is
    `*:not(#uier-toolbar):not([data-uier-thread])` (the id also outweighs the page's own rules, as
    `!important` does theirs), and `#uier-toolbar` keeps the letter and word spacing it had: they are
    inherited, the host is in the page, and its shadow root (`[data-uier-root]`) resets them as well.
  - **Nothing is left on the page**: exactly that sheet is removed when the toggle goes off, Check again
    runs (the store drops a manual report; removed in a layout effect, before the new checks read the
    page), the toolbar collapses, the panel closes or the page changes (the section unmounts), and when
    the check is cancelled or fails (the logic removes its own sheet). A check that starts after the
    toggle went off adds nothing (`spacingWanted`).
  - Its findings show only while it is on, so they do not count on the button (`attention: () => 0`).

## Motion

`motion` runs when the panel opens and on Check again (`panel`): animations often start after load,
and a background check would miss them. What it finds is what moves at that moment.

- **Animations** (`motion-animation`, WCAG 2.2.2): `document.getAnimations()` (CSS animations,
  transitions, the Web Animations API) that are running on a rendered element and never end or are
  active for more than five seconds (`getComputedTiming().activeDuration` over the playback rate). Not
  the toolbar's own (its spinners never end), also inside its shadow root, and not a marquee's. An issue
  per element, "Animates without end" or "Animates for 30 s", with the animation's name in the comment:
  the toolbar cannot know whether the page offers a way to pause it.
- **Video and audio** (`motion-media`): players without `controls` that play on their own (`autoplay`,
  or playing) in a loop, for more than five seconds or for an unknown length. Audio takes no room on the
  page, so its issue is about the page; unmuted players mention WCAG 1.4.2.
- **Notes** (not counted): GIF images (`motion-gif`), counted by address (by file name or `data:`
  type, never by content: one may or may not animate), each with Highlight and Comment; and, only when
  something moves (a running animation, a player, a marquee), whether a stylesheet the page lets us read
  (`document.styleSheets` and adopted sheets, through `@import`, `@media`, `@supports`, `@layer` and
  nesting) has a `prefers-reduced-motion` rule (`motion-reduced`). Stylesheets from other origins cannot
  be read: "not found in the stylesheets this page lets us read". With reduced motion on in the
  reviewer's browser, the note says the page may move less there.

## Tests

`apps/web/e2e/page-checks-content.spec.ts` on `site.origin('fixture-content')`
(`e2e/support/fixtures/content.ts`: images and the stylesheet from the fixture's own origin, with the
install guide's CSP, which allows no inline styles): the alt text rows, thumbnails (attributes, a
failed load's placeholder), flags, "Show all", Highlight, two comments and the flags on the button's
count (Desktop Chrome); reflow at 1280 px (the wide element, not the one in a scroll box or the fixed
one) and its comment; text spacing's values on the page, its rows and comment, the toolbar's own
sizes and spacing unchanged, and the sheet gone after the toggle, closing the panel, Check again,
collapsing, a client-side navigation and closing it while it is applied (Desktop Chrome); motion's rows
without the short animation, the toolbar or the marquee (axe-core's rule), its comment and both
reduced-motion notes (Desktop Chrome); the reflow wording at a phone's width (Mobile Chrome). Each
runs `expectNoAxeViolations` on the open panel. The phone test opens the page with `?clip`
(`html, body { overflow-x: clip }`): on a phone, a page that scrolls sideways widens Chrome's layout
viewport to its content (`innerWidth` 1572 on a 393 px screen), and the toolbar's fixed controls move
off the screen with it.
