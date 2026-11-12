# Keyboard and screen reader sections

Two sections of the Accessibility panel, each in its own tab (Keyboard, Screen reader; [page checks](page-checks.md#sections)), cover what the
automated audit cannot judge: how a keyboard moves through the page, and what a screen reader user
navigates by. They add what axe-core does not report; missing names, `aria-hidden` focusable elements
and the landmark rules stay with the audit above them. Logic: `src/checks/lazy/keyboard.ts` and
`lazy/screenReader.ts` (in the audit asset); views: `components/checks/sections/KeyboardSection.tsx`
and `ScreenReaderSection.tsx`.

## Tools

**Show tab order** and **Check focus indicators** are two buttons with icons (Lucide's list-ordered
and focus, drawn in `ChecksIcons.tsx`) above the Keyboard section's card, in the Keyboard tab
([uier #228](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_wJf6YX8AiP9Go6faFCjO2)):
`[data-uier-keyboard-tools]`, one bordered card each, side by side and stacked when narrow. Each card
keeps its description under its button, also once the tool ran; the focus check's status is in its
card and its findings are rows of the Keyboard section. They show once the section has a report
(Show tab order only with a stop). The focus button shows a spinner while the check runs.
A label longer than its card (a narrow panel, a longer language) wraps inside its button, which grows
with it, the icon on the first line
([uier #234](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2F5uauxu25b2es&comment=comment_Zt07Ue_Ah6QrUoURMoDMW)).

## Tab order

`tabOrder()` computes the sequential focus order (`when: 'panel'`): focusable elements (links and
areas with `href`, buttons, fields, frames, the first `summary` of a `details`, `audio`/`video` with
controls, editing hosts, `[tabindex]`) that are not disabled, not `inert` (only the open modal
dialog's content while one is open), rendered (`checkVisibility` with `visibility`) and without a
negative tabindex. Positive tabindex first in ascending order, then document order, per focus scope:
an open shadow root's stops come in its host's place (a host with a negative tabindex keeps them out;
one that delegates focus is no stop itself), a slot's assigned elements in the slot's. A named radio
group is one stop (its checked radio, else its first), a frame is one stop. The toolbar's host and
inline threads are left out (`isToolbarNode`).

- **Tab stops** (a note): how many.
- **Positive tabindex** (a warning, an issue on each): they jump the order.
- **Hidden tab stops** (a warning to review, an issue on each): stops that cannot be seen
  (`hiddenReason`): no size (under 2 px), off the page above or left of it (where nobody can scroll),
  opacity 0 on it or an ancestor, or clipped away (`clip` / `clip-path: inset(50%)`, or an ancestor of
  under 2 px that clips its overflow). A field whose label can be seen is not hidden (a styled
  checkbox). Hidden in-page links to a target on the page ("Skip to content") are left out and
  counted in the reason: they usually show on focus, which the focus check below confirms.
  The focus guards of the toolbar's own menus (Radix's `data-radix-focus-guard` spans on the page's body, there
  until a closing menu is gone) are left out, so a panel opened from the Page checks menu does not count them:
  `src/focusGuards.ts` marks a guard `data-uier-focus-guard` when it is new and appears while one of the toolbar's
  own Radix layers (a popover, menu or dialog in its shadow root) is open. The page's own guards (a force-mounted, closed Radix popover keeps them) are reported like any stop.

**Show tab order** (`aria-pressed`) draws the order over the page: each stop's number centred on its
element's top-left corner (kept 10 px inside the window), and a line with an arrow from each stop to
the next, clear of the numbers. Only the stops in the window are numbered, at most 100 at a time; the
panel says when there are more. The layout (`tabOrderLayout`) is measured again on every
`useLayoutVersion()` change. It is a portal into the shadow root's `rootElement`, inside `InkScope`:
numbers are text, ink with a light ring, and the line is light on a dark edge, so both read on any
page. `z-[47]`, under pins and the Highlight outline, `pointer-events: none`, `aria-hidden`. It hides
while the toolbar is collapsed (`usePageLayerVisible`) and is gone when the panel closes (the toggle
starts off when the panel opens again).

## Focus indicators (manual)

**Check focus indicators** (`when: 'manual'`; its description says it moves the focus and runs the
page's focus handlers) moves the focus through the tab order, at most 100 stops (the rest are named
in the reason), skipping frames. For each stop: blur whatever has the focus (a clean "before", also
for `:focus-within`), read the styles, `focus({ preventScroll: true, focusVisible: true })`, wait a
frame (an indicator a script draws), read them again. Read are the outline, border, box shadow,
background, text decoration, colour, opacity, transform and visibility of the element, its
`::before`/`::after`, up to four ancestors (`:focus-within`), its first four descendants, its labels
and, for an input, the next sibling (`input:focus-visible + span`). Running CSS transitions on them
are finished first, so a transition never reads as "no change". Results are findings to review, each
an issue: **No visible change when focused** (`focus-indicator`, WCAG 2.4.7) and **Not visible when
focused** (`focus-hidden`: still hidden with the focus, such as a skip link that never shows). A stop
that does not keep the focus (a handler moved it) is skipped and counted.

**Keyboard focus styles.** Browsers apply `:focus-visible` to a script's `focus()` only after keyboard
interaction: started by a click, most pages' focus styles would not show and every stop would look
unchanged. So every focus asks for them (`focusVisible: true`, which Chromium honours), and after each
focus the stop must match `:focus-visible`. If one does not (a browser without that option, after a
click), the run stops and reports nothing but a note: "Not checked: the browser showed no keyboard
focus styles, since the check started with a click. Press Enter on Check focus indicators to start it
from the keyboard." The button keeps the focus for that (it focuses itself on click, as Safari does
not). After any key press (Shift or Enter), Chromium applies keyboard focus styles to a script's
focus; Firefox and Safari were not tested, and the `:focus-visible` check covers them either way.

Restored in `finally`, also when cancelled: the focus goes back to what had it (the button) and the
window's scroll to where it was (`behavior: 'instant'`), even when a page's focus handler scrolled.
Closing the panel cancels a running check (`focusCheck`, the section's own `AbortController`: the
sections store keeps a closed panel's checks running) and leaves no report; Check again drops its
report, as for every manual section. The section has no live region until the check starts (the
panel has one status); then a `role="status"` says it is moving the focus and, once done, the result.

## Screen reader outline

`screenReaderOutline(axe)` runs inside `withAxe` (`when: 'panel'`): it calls `axe.setup(document)`
for axe-core 4.14's virtual tree and `axe.teardown()` in `finally`. It walks the flat tree (open
shadow roots in place) in reading order, skipping `head` and the toolbar, and uses axe-core's own
`commons.aria.getRole(node, { noPresentational: true })`, `commons.text.accessibleTextVirtual` and
`commons.dom.isVisibleToScreenReaders` (not in axe-core's types; typed locally as `AxeHelpers`).

- Landmarks: banner, navigation, main, complementary, contentinfo, search, and region and form
  only with a name. Headings: role `heading` with `aria-level`, else the `h1`-`h6` level, else 2.
  Controls: links, buttons, text fields, comboboxes, list boxes, checkboxes, radios, switches,
  sliders, spin buttons, tabs and menu items, with their states: expanded or collapsed (also a
  `details` summary), pressed, checked (native or ARIA, partly for mixed), required, invalid, disabled.
- The view: two folded lists (like the SEO panel's Outline) with their counts, "Landmarks and
  headings" (indented by the landmarks they are in) and "Controls", each item as its role (or `h2`)
  in mono, its name ("No name" in italics) and states, with Highlight. The first 50, then "Show all".
- Checks: the counts of landmarks (with their roles), headings (their levels) and controls are notes.
  **Links and buttons with one name** (`sr-same-name`, a warning with an issue on each): several links
  with one name (case and spacing aside) to different addresses (origin, path without a trailing
  slash, query and hash), or buttons with one name that act on different things: different
  `aria-controls`, else different list items, rows or articles ("Add to cart" per product), else
  different forms or values. A link or button with `aria-describedby` / `aria-description` is left
  out (the description tells them apart). Several landmarks of one kind without names are not a
  check here: axe-core's `landmark-unique` (on by default) reports them; the outline shows "No name".

## Tests

`apps/web/e2e/page-checks-keyboard.spec.ts` (Desktop Chrome) on `fixture-keyboard`
(`e2e/support/fixtures/keyboard.ts`): the tools above the section, with their descriptions; the tab order's checks and the overlay's numbers at their
elements in order (positive tabindex first, the skip link off screen and unnumbered, one radio stop,
the shadow root's button), following the scroll, hidden while collapsed and gone with the panel, and
a comment's text and check; the focus check from the keyboard and from a click (Chromium honours
`focusVisible`), its findings (no `outline: none` button without a replacement; not the
`:focus-visible` ring, the `:focus-within` wrapper or the skip link that shows on focus), focus and
scroll restored after a page handler scrolled, Check again dropping it; with `focusVisible` ignored
(an init script), a click reports "Not checked" and Enter then checks; the outline's landmarks,
headings and controls with names and states, Highlight, three "Read more" links to different pages
(two "Plans" links to one page are fine) and its comment; `expectNoAxeViolations` on the panel.
