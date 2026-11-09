# Anchor recovery

`CommentAnchorDetails` shows anchors that need attention (moved text, hidden, missing, ambiguous) with
Reattach comment; a matching anchor stays quiet (`data-uier-anchor-state` only) and author/admin
reattachment is in the first message's menu (`useReattach`). An anchor in a closed menu, popover or
dialog (`closed`) is not broken: its line says which element opens it, without Reattach.
`layerAnchor.ts` (`withLayer`) saves that element when an anchor is chosen (new comments and
reattaching) while the layer is open: `modalLayer.ts`'s `layerOpener` finds the expanded
`aria-controls` trigger, else the `popovertarget`/`commandfor` invoker, outermost for nested layers;
its name is limited to the API's 120 visible characters. `getCommentPlacement` places a hidden or missing anchor
with a `layer` on that opener while it is shown and not expanded; areas are not outlined there.
`CommentsGlobal` reuses the point overlay and selection offsets, with a dockable confirm/cancel panel
and compact instructions while choosing. The saved thread is changed only after confirmation; collapse
cancels choosing. Anchor updates use `PATCH .../anchor`, the saved page key and expected revision.
Keep original and previous context, and never invent fallback pins for missing or ambiguous targets
(the saved opener of a closed layer is the one fallback).
`e2e/reattach*.spec.ts` covers recovery, access, races, layout changes and light/dark accessibility.

- Project review info supplies environment labels and explicit alias groups. Pins always use the
  current environment; inbox lists and activity use the saved environment chosen in the inbox's
  location picker (All environments until one is chosen).
  Scope query keys by that selection and reviewer. A thread's server-provided `source` owns its
  original link; missing/removed sources have no executable link. Keep foreign-environment items
  out of This page/Show on page even when paths match (the location picker keys pages by environment and path). Direct links override saved filters for the
  visit. Filter preferences use the versioned `uier:environment:v1:` key and contain no credentials.
