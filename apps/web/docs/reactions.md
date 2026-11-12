# Message reactions

Emoji reactions to a thread's messages: the first message and each reply, in the app's open thread and in
the toolbar's threads (pin popovers, the inbox, inline threads). The toolbar side is
[packages/toolbar/docs/reactions.md](../../../packages/toolbar/docs/reactions.md).

## The quick set

`@uier/toolbar/reactions` (`packages/toolbar/src/reactions.ts`, pure) is the vocabulary the API, the app and the
toolbar share: GitHub's quick set in its order, as stable ids (`thumbs-up`, `thumbs-down`, `laugh`, `hooray`,
`confused`, `heart`, `rocket`, `eyes`), their emoji and English names, the limits, the view type
`MessageReaction` (`{ emoji, count, mine, names }`), `withOwnReaction` (the optimistic toggle both clients use)
and `reactionPeople` (who reacted, in reading order). There is no free emoji input.

## Storage and permissions

- Reactions are stored on the message itself (`DbThreadItem.reactions`: per emoji, the reactors' author ids,
  oldest first, and a project guest's given name), so realtime, lists and exports see them with the thread.
  `comments/reactions.ts` owns the change (`withReaction`) and the projection (`reactionViews`).
- A message holds at most `MAX_MESSAGE_REACTIONS` (100) reactions over all emoji, which keeps a 50-message
  thread's document bounded; the next one is refused with `400`. Removing one makes room.
- Who may react is who may reply: someone with a visitor id or a member, while the project's comments are open
  to them (`refreshMutationActor(..., true)` on every write attempt), on a thread they can see. A deleted message
  (the first message's placeholder) takes none. Thread length (`MAX_THREAD_ITEMS`) does not matter. The app shows
  the controls with `permissions.react`.
- A reaction is not content. `setProjectCommentReaction` writes through `changeComment(..., { ephemeral: true,
  requireComments: true })`: only the message's reactions and the etag change. No unread activity, thread history,
  notification event, integration sync, AI title, `updatedAt` or content revision (`commentRevision` leaves
  reactions out, so a reaction never makes a triage or verification guard stale).
- Each request counts once against its own limits (`enforceReactionLimits`): 120 per visitor and 600 per member
  per hour in a project, and 300 per IP address for non-members, apart from the reply and IP write limits.

## API

- Review API: `POST /api/review/<code>/comments/<id>/reactions` with `{ itemId, emoji, reacted, authorName? }`
  (`authorName` only kept for guests), answered with the thread DTO. It has the review API's CORS, identity and
  BotID write checks, and the packaged extension's broker allows it (`extensionContract.ts`).
- Public comments API (uier's own pages): `POST /api/comments/<id>/reactions` with `{ itemId, emoji, reacted }`,
  `assertNotBot`, the visitor's own author id.
- The app: `reactToCommentAction` (zod, `appContextOrThrow`, the same service), revalidating the project page.
- `reacted` sets the state rather than flipping it, so a repeated request changes nothing.

## Views

- Thread item DTOs and the app's `ProjectCommentMessage` (and, for the first message, `ProjectCommentView.messageId`
  and `reactions`) carry `reactions` only when there are some: per emoji its count, `mine` and the names of up to
  `MAX_REACTION_NAMES` (10) others, oldest first. Names are current account names (`authorNames` loads reactors
  too), a guest's given name, or the guest code ("Guest 1A2B") for a guest without one. Ids never leave the server.
- Copy issue, exports and MCP packets list counts per emoji under each message ("Reactions: 👍 Thumbs up (2)"),
  never who reacted (`FeedbackMessage.reactions`). Tracker deliveries (`integrations/delivery.ts`) leave them out:
  a reaction requests no sync, so an issue would keep a stale count.

## The app

`comments/MessageReactions.tsx`, a component of its own beside `CommentCard`'s `Message`, so the message layout and
composers can change without it:

- `ReactionPicker`: Add reaction (lucide's smile-plus, a ghost icon button with its tooltip) in the message's header,
  beside a reply's More actions. Its popover is a multiple `ToggleGroup` of the quick set: each emoji named by what it
  shows ("Thumbs up"), pressed for the member's own, arrow keys between them; a choice closes it.
- `ReactionList`: under the message (after its image), a "Reactions" group of outline `Toggle` pills: the emoji and
  the count, `aria-pressed` for the member's own. The name says the emoji and the count ("Thumbs up, 2 reactions");
  who reacted ("You, Ana and 2 others reacted") is its description and its tooltip, on hover, keyboard focus, or a
  long press on a touch screen (which then does not toggle).
- A press shows at once through `CommentUpdates` (`{ reaction }`, applied to whatever the thread shows), then the
  action's fresh snapshot replaces it; a failure falls back and toasts.

## Tests

`e2e/reactions.api.spec.ts` covers storage, idempotency, permissions (disabled, invited, private, deleted,
anonymous), the bound, what a reaction leaves unchanged, the views and names, the review route's validation, the
public API, packets and the shared helpers. `e2e/reactions.spec.ts` (full suite) covers the app and the toolbar on
desktop and mobile with axe.
