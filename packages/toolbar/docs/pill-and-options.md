# The pill, Options and notices

The pill is the toolbar's black bar (`components/CommentToolbar.tsx`). Its profile and options popovers are
`ToolbarProfile.tsx` and `ToolbarOptions.tsx`. `hooks/useReviewMovement.ts` and `components/DockablePanel.tsx`
move the pill and dock its panels, and `useToolbarNotice` places notices by it.

## The pill

- A `nav` landmark. Its buttons: Add comment, Draw on the page ([canvas mode](canvas-mode.md), the optional
  feature `draw`), Inbox with the blue unread count, Page checks (from 640 px: a menu of Accessibility, SEO and
  Security and compliance, `checks/PageChecksMenu.tsx`, or the one tool's own button when only one is on; narrower
  they are rows of Options, [page checks](page-checks.md#where-they-open)), About, Profile, Options and Collapse / Expand.
- The buttons are a `role="toolbar"` with one tab stop and ← → between them; the move handle is beside it
  ([keyboard](keyboard.md#composites)).
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
- Every options row is an `OptionButton`: a 16 px icon 8 px from its label, so the icons line up in one
  column. A list for Keyboard shortcuts, the toggle for the switch, a back arrow for All options, rotate-ccw for
  reset, the mark for "Powered by uier". Switch rows: [switches in menus](keyboard.md#switches-in-menus).

## Moving and docking

`hooks/useReviewMovement.ts` and `components/DockablePanel.tsx` share the pointer and touch handles, the visible
viewport's bounds, the toolbar's position and reusable panel docking (the inbox and the page-check panels,
[page checks](page-checks.md#where-they-open)). Positions are versioned browser-local preferences, and each
handle has keyboard alternatives (the move handle's arrows move the pill).

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
