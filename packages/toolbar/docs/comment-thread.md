# Pins and threads

A saved comment is a pin on the page with its thread in a popover (`components/CommentBubble.tsx`,
`CommentThread*.tsx`, `PinParticipants.tsx`); the inbox shows the same thread. Where the pin and its popover go,
the people beside a pin, the hover preview and the new comment's form are in [popovers](composer-popovers.md).

The app's `CommentCard` follows the same layout, icons and words: change both together. One difference: the app's
thread has its title and details between its top line and the messages, so its first message keeps its own header
line (author, time, device, Add reaction; its options are already in the thread's More actions).

## The pin

`<Pin />` from `@uier/brand`: the issue number inside, the message count as its bottom-right badge from the
first reply, named "Comment #6, 3 messages", and the thread's people beside it
([who is in the thread](composer-popovers.md#who-is-in-the-thread)).

The thread's status but Open is on the pin too (`PinStatus.tsx`, uier #364): an 8 px solid dot in the
status's colour (by category for custom statuses, uier #402) with a white ring like the pin's and a soft halo of
its colour, on its round top-right edge above the message count (uier #397), so the pin keeps its size and reads
on light and dark pages. It is the glowing dot of the app's board column headers (`GlowingStateDot`) scaled for
the pin (uier #408). The white ring is ink-scope like the pin's, but the dot takes the threads' theme (light or
dark status tokens), so it is the same colour as the app's status dots (uier #426). The pin's name
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
- Messages have an avatar column and no dividers. The first message is the thread itself
  ([uier #470](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fwl3q4fzid2uh&comment=comment_9tXqLlAhDRyRV0Y8QbPLq)):
  its author, time and device are in [the header](#the-header) line and its text starts right under that line, at
  full width (`CommentThreadItem`'s `header`). Replies keep their avatar, their own header line with Add reaction
  and More options.
- A longer thread shows its first and last message with "Show all N messages" between them, set between two
  `bg-border` lines so the gap reads as hidden messages (uier #443). Using it shows them and moves focus to the first.
- No thread activity (who changed what): that history is in the app only (uier #374).
- A saved screenshot is a thumbnail ([saved images](screenshots.md#saved-images)).

## The header

`CommentThreadHeader.tsx` is one line, the thread's and its first message's together (uier #470). It wraps only
where it is too narrow, as in a pin's 288 px popover: the first message's author and time move under the status as
one piece, its name truncated, and the device marks and actions stay on the first line.

- The status: a menu like the app's `StateMenu` (Open, In progress, Ready to verify, Done) for those who may
  change it, else a badge ([status changes](optimistic-status.md)). Its dot glows like the app's status chip
  (`GlowingStatusDot`, the app's `GlowingStateDot`, [uier #462](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1&comment=comment_nq7Ckm6_THp5pfj30OEra)); the menu's options do not.
- `#id`, then the blue unread dot, which marks the thread read.
- A priority other than Normal.
- The first message's author (no avatar), "via" its agent and its time.
- At the right: the assignee's avatar from `CommentAssignment.tsx`, with the AI agent working under them stacked on it (the
  marks from `agents.ts`), named by its tooltip ("Assigned to you, with Claude").
- The first message's device marks ([device details](device-details.md)).
- Add reaction to the first message ([reactions](reactions.md)), hidden while it is edited.
- Then **Copy**: a menu with Copy issue ([feedback export](feedback-export.md)) and Copy link (`?uier-comment=`,
  `src/review.ts`), each described.
- Add reaction, Copy and Thread options are 24 px buttons with 14 px icons (Thread options' is 16 px); a coarse
  pointer still gets its 44 px hit area.
- Then **Thread options** (`CommentThreadMenu.tsx`), the thread's one menu: first the first message's Edit and
  Reattach comment, then the triage and email controls each person may use: assign (the people open under the line: Unassign, the people, Done; until the people load, two outlines of a
  person's row hold their place, `aria-hidden`, and a visually hidden `role="status"` says "Loading people…"),
  priority, Request verification ([fix verification](fix-verification.md)),
  Follow / Unfollow thread, Mute project emails and, once read, Mark as unread, Open in app, and last the first message's
  Delete… (destructive), which asks in the menu what deleting does before Delete. The first message's items are
  left out while it is edited, and wait while it saves. No menu when there is none, and none on a comment still
  on its way.
  Members (the project's viewer is a member, `useProjectViewer`) also get Open in app: a link to the thread in the
  app's inbox (`/app/projects/<code>?comment=<id>`, as in [the app's inbox](../../../apps/web/docs/comments-inbox.md)) in
  a new tab ([uier #445](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1&comment=comment_z-D8sz84XrnMwNuGLXLMF)).
  Each item has a 16 px icon, like the toolbar's other menus. Opened from the inbox, the menu renders in the ink
  scope, so it stays dark like the inbox; a thread on the page opens it in the toolbar root, in the thread's theme.

## Message options

A reply's More options (`components/CommentThreadItemMenu.tsx`): edit, with Save and Cancel and stale-edit
protection; delete, with a confirmation. The first message's edit, Reattach comment ([anchor recovery](anchor-recovery.md))
and delete are in Thread options. For an edit, `CommentThreadItem.tsx` renders an inline `CommentComposer`, keeps
failed text and returns the focus to the menu it came from (Thread options for the first message).
The edit's Cancel (a cross) and Save changes (a check) are icon buttons with tooltips and those accessible names, so
long translations fit the narrow editor ([uier #395](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1%2Fpage-checks&comment=comment_F7pueH_f-8c5J-ATyyooS)).

## Icon buttons

Icon buttons show their names with `IconTooltip` / `useIconTooltip`: on hover after 300 ms, at once on keyboard
focus, portaled into the shadow root's container with a fixed position, decorative, never on touch. Use it
instead of `title` for icon-only controls.

Project member threads show effective assigned labels below the discussion. Members who can triage can open Labels to add/remove one label at a time; saves keep controls disabled, retain server values on failure and refresh the shared comment cache. Catalogs use the member-only review labels endpoint; guest DTOs omit assignments and guests never fetch the catalog.
