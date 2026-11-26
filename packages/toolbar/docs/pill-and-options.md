# The pill, Options and notices

The pill is the toolbar's black bar (`components/CommentToolbar.tsx`). Its profile and options popovers are
`ToolbarProfile.tsx` and `ToolbarOptions.tsx`. `hooks/useReviewMovement.ts` and `components/DockablePanel.tsx`
move the pill and dock its panels, and `useToolbarNotice` places notices by it.

The pill, the docked panels, the popovers and menus, notices and toasts share the review layer's floating shadow
(`--brand-shadow-review` from `@uier/brand`, `floatingShadowClassName`), stronger than the site's, so they stand apart
from any page.

## The pill

- A `nav` landmark. Its buttons: Add comment, Draw on the page ([canvas mode](canvas-mode.md), the optional
  feature `draw`), Inbox with the blue unread count, Page checks (from 640 px: a menu of Accessibility, SEO and
  Security and compliance, `checks/PageChecksMenu.tsx`, or the one tool's own button when only one is on; narrower
  they are rows of Options, [page checks](page-checks.md#where-they-open)), About, Profile, Options and Collapse / Expand.
- The buttons are a `role="toolbar"` with one tab stop and ← → between them; the move handle is beside it
  ([keyboard](keyboard.md#composites)).
- The pill never scrolls sideways ([uier #512](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Flegal%2Fprivacy-policy&comment=comment_vLb5jOsfnYz_DNFDXiDye)).
  Its buttons keep their size (44 px for touch). When they don't fit the visible viewport less 32 px, Profile
  moves into Options first, then Draw on the page, then About (`usePillRoom`, measured from the move handle).
  Profile's name and description are then at the top of Options, and Draw and About are rows there. Closing the
  canvas or the hint gives the focus back to Options. On a 393 px phone a guest on the landing page has Profile
  and Draw in Options. At 320 px About is there too. A signed-in member keeps Draw from 360 px and Profile from
  403 px.
- The point-mode instruction (`role="status"`) shows by the pill. In its place, while a draft pin is closed,
  **Resume draft** opens the latest one ([several drafts](composer-popovers.md#several-drafts-on-a-page)).
  Both are outside the pill, so its width never changes.

## Collapsing

Collapse hides the on-page review layer and cancels the placement and selection controls. Draft text and the
inbox's state stay. Collapsing also ends canvas mode ([canvas mode](canvas-mode.md)) and anchor choosing
([anchor recovery](anchor-recovery.md)); the shortcuts act only while the toolbar is expanded
([keyboard](keyboard.md#shortcuts)).

## Profile and Options

- Profile: the guest's or the account's name. Signed in, its button shows the account's initial, like the
  app's avatar.
- Options:
  - Keyboard shortcuts, where a keyboard is likely (and always while they are off): the switch that turns them
    off and their list, also on `?` ([keyboard](keyboard.md)).
  - Language, with Default first ([languages](localization.md)).
  - Environment: this page on another of the project's addresses, when it has more than one
    ([environments](../../../apps/web/docs/environments.md)).
  - Accessibility, SEO and Security and compliance on a narrow screen.
  - Reset moved toolbar, View project, Exit review and Sign out. On uier's own pages, account sign-out stays in
    the app's account menu.
- Options always ends with "Powered by uier", a link to uier.io: the toolbar runs on other people's sites.
- Options is never taller than the room beside the pill, and scrolls inside when a short window has less room.
- Every options row is an `OptionButton`: a 16 px icon 8 px from its label, so the icons line up in one
  column. A list for Keyboard shortcuts, the toggle for the switch, a back arrow for All options, rotate-ccw for
  reset, the mark for "Powered by uier". Switch rows: [switches in menus](keyboard.md#switches-in-menus).

## Moving and docking

`hooks/useReviewMovement.ts` and `components/DockablePanel.tsx` share the pointer and touch handles, the visible
viewport's bounds, the toolbar's position and reusable panel docking (the inbox and the page-check panels,
[page checks](page-checks.md#where-they-open)). Positions are versioned browser-local preferences, and each
handle has keyboard alternatives (the move handle's arrows move the pill).

- A panel docks on a whole side or a quarter of the page, the top or bottom half of a side
  ([uier #388](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects&comment=comment_0-3lpwzgbghwy4WWjb3yN),
  `PanelDock`: `left`, `right`, `left-top`, `right-top`, `left-bottom`, `right-bottom`). Dragging its handle moves
  the panel's centre: the half of the page it is over picks the side, its top or bottom third a quarter, and the
  outline shows the place with "Move to the top left". The handle's left and right arrows change the side and keep
  the quarter, up and down go from the whole side to its top or bottom quarter and back, Home goes back to the right.
  The place is kept per panel in `uier:panel-side:v1:<panel>` (the key predates the quarters, so a saved side is
  still a whole side), and the aside says it in `data-dock` (`data-side` stays the side, for the slide animation).
  Quarters are 16 px apart; narrower than 640 px a panel still covers the page wherever it docks.
- A panel slides in from and out to its side (`panelEnter`, `panelExit`; only a fade with reduced motion), and its
  Close shows panel-right-close on the right and the mirrored panel-left-close on the left (`PanelCloseIcon`,
  `data-uier-panel-close-icon`; [uier #487](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000003&comment=comment_17QAsGT-bCVY03vOOHlui)).
  The slides use tailwindcss-animate's `-full` values: the bare `slide-in-from-left` compiles to nothing in this build.

## Notices by the pill

`useToolbarNotice` places a notice by the pill: the point-mode instruction, Resume draft, toasts and the load
error. It is centred on the pill, above it, or below when there is no room above, inside the viewport, so it
never covers the pill.

`components/CommentsErrorMessage.tsx` and `Toaster.tsx` turn API errors into friendly messages (`rate_limited`
with `reason: "too_fast" | "page_full"`, ...). A member's limit adds **View usage**, the API's usage page
([usage](../../../apps/web/docs/usage.md)).

## Tests

`apps/web/e2e/review.spec.ts`: review links and the pill's controls. `composer-hints.spec.ts` (desktop and
mobile): Resume draft.

`review.spec.ts` checks the complete narrow-screen Options action list, including Security and compliance.
