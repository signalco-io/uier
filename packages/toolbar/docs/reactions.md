# Message reactions

Emoji reactions to each message of a thread (the first one and the replies) in pin popovers, the inbox and inline
threads. Storage, permissions, limits and the API are in
[the app's note](../../../apps/web/docs/reactions.md); the quick set and its helpers are `src/reactions.ts`
(`@uier/toolbar/reactions`), shared with the app and the API.

- `components/MessageReactions.tsx`, separate from `CommentThreadItem` so composers and message layouts can change
  without it:
  - `ReactionPicker`: Add reaction (an outlined smile-plus drawn like the kit's icons) beside the message's options,
    with its `IconTooltip`. Its popover (`toolbarSurface('uier-reaction-picker')`, rendered in the shadow root) is
    the quick set as toggle buttons named by what they show ("Thumbs up") with their names as tooltips,
    `aria-pressed` for the reviewer's own; ← → ↑ ↓, Home and End move between them, a choice closes it.
  - `ReactionList`: under the message, a "Reactions" group of pills: the emoji and the count, `aria-pressed` when
    one is the reviewer's. The name says the emoji and the count ("Thumbs up, 2 reactions"); who reacted ("You,
    Ana and 2 others reacted", `Intl.ListFormat` in the toolbar's language) is its description and its tooltip,
    shown on hover, keyboard focus, or after a 500 ms touch or pen press (`useIconTooltip`'s `open`), which then
    does not toggle. Pills are ink, never blue (the review layer's rule); the reviewer's own has a stronger border
    and the accent surface.
  - Messages still on their way (`pending`) and deleted messages have no reactions.
- `hooks/useReactions.ts` (`useReaction`): `POST .../comments/<id>/reactions` with `{ itemId, emoji, reacted }` (a
  project's guest adds the name they gave). The reaction shows at once in every cached list (`withOwnReaction`),
  then the API's thread replaces it (`updateCachedComment`); an older answer never overwrites a newer press of the
  same emoji. A failure puts it back and shows "Reaction not saved" with the API's reason.
- Others' reactions arrive with the thread through realtime and the refresh scheduler: a reaction changes the
  document's etag, which the realtime source watches ([realtime](realtime.md)).
- Strings are in `reactions` of every catalog ([localization](localization.md)); the ids never are.
