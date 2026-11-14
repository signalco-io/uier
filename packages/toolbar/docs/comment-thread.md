# Pins and threads

A saved comment is a pin on the page with its thread in a popover (`components/CommentBubble.tsx`,
`CommentThread*.tsx`, `PinParticipants.tsx`); the inbox shows the same thread. Where the pin and its popover go,
the people beside a pin, the hover preview and the new comment's form are in [popovers](composer-popovers.md).

The app's `CommentCard` follows the same layout, icons and words: change both together.

## The pin

`<Pin />` from `@uier/brand`: the issue number inside, the message count as its bottom-right badge from the
first reply, named "Comment #6, 3 messages", and the thread's people beside it
([who is in the thread](composer-popovers.md#who-is-in-the-thread)).

The thread's status but Open is on the pin too (`PinStatus.tsx`, uier #364): a 10 px circle with a border in
the status's colour and a soft gradient of it (by category for custom statuses), in the pin's white ring, on its
round top-right edge above the message count (uier #397), so the pin keeps its size and reads on light and dark
pages. It is a smaller, quieter take on the glowing dots of the app's board columns. The pin's name
ends with the status ("Comment #6, 3 messages, In progress", a custom status's own name; `selectedWorkflowStatus`
as in the header). It follows the cached comment, so optimistic changes ([optimistic status](optimistic-status.md))
and realtime updates show at once. Done pins leave the page, so Done shows only on a pin kept for its draft.
Checked in `apps/web/e2e/toolbar-thread.spec.ts`.

## The thread

- The popover is bounded by the window and clear of the pill
  ([where it goes](composer-popovers.md#where-the-pin-and-its-popover-go)). A mouse resting on the pin previews
  it read-only ([hover preview](composer-popovers.md#hover-preview)). The popover has the reply form.
- One thread layout for the popover and the inbox, so an opened thread shows its messages and reply box first.
- The source line shows in the inbox, and on the page only when the original source is unavailable.
- Messages have an avatar column and no dividers.
- No thread activity (who changed what): that history is in the app only (uier #374).
- A saved screenshot is a thumbnail ([saved images](screenshots.md#saved-images)).

## The header

`CommentThreadHeader.tsx` is one line:

- The status: a menu like the app's `StateMenu` (Open, In progress, Ready to verify, Done) for those who may
  change it, else a badge ([status changes](optimistic-status.md)).
- `#id`, then the blue unread dot, which marks the thread read.
- A priority other than Normal.
- The assignee's avatar from `CommentAssignment.tsx`, with the AI agent working under them stacked on it (the
  marks from `agents.ts`), named by its tooltip ("Assigned to you, with Claude").
- Then **Copy**: a menu with Copy issue ([feedback export](feedback-export.md)) and Copy link (`?uier-comment=`,
  `src/review.ts`), each described.
- Then **Thread options** (`CommentThreadMenu.tsx`), with the triage and email controls each person may use:
  assign (the people open under the line), priority, Request verification ([fix verification](fix-verification.md)),
  Follow / Unfollow thread, Mute project emails and, once read, Mark as unread. No menu when there is none.
  Each item has a 16 px icon, like the toolbar's other menus. Opened from the inbox, the menu renders in the ink
  scope, so it stays dark like the inbox; a thread on the page opens it in the toolbar root, in the thread's theme.

## Message options

`components/CommentThreadItemMenu.tsx`: edit, with Save and Cancel and stale-edit protection; Reattach comment on
the first message ([anchor recovery](anchor-recovery.md)); delete, with a confirmation. For an edit,
`CommentThreadItem.tsx` renders an inline `CommentComposer`, keeps failed text and returns the focus to the menu.
The edit's Cancel (a cross) and Save changes (a check) are icon buttons with tooltips and those accessible names, so
long translations fit the narrow editor ([uier #395](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1%2Fpage-checks&comment=comment_F7pueH_f-8c5J-ATyyooS)).

## Icon buttons

Icon buttons show their names with `IconTooltip` / `useIconTooltip`: on hover after 300 ms, at once on keyboard
focus, portaled into the shadow root's container with a fixed position, decorative, never on touch. Use it
instead of `title` for icon-only controls.

Project member threads show effective assigned labels below the discussion. Members who can triage can open Labels to add/remove one label at a time; saves keep controls disabled, retain server values on failure and refresh the shared comment cache. Catalogs use the member-only review labels endpoint; guest DTOs omit assignments and guests never fetch the catalog.
