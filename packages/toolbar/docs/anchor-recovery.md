# Anchor recovery

`CommentAnchorDetails` shows anchors that need attention (moved text, hidden, missing, ambiguous) with
Reattach comment; a matching anchor stays quiet (`data-uier-anchor-state` only) and author/admin
reattachment is in the first message's menu (`useReattach`). An anchor in a closed menu, popover or
dialog (`closed`) is not broken: its line says which element opens it, without Reattach.
`layerAnchor.ts` (`withLayer`) saves that element when an anchor is chosen (new comments and
reattaching) while the layer is open: `modalLayer.ts`'s `layerOpener` finds the expanded
`aria-controls` trigger, else the `popovertarget`/`commandfor` invoker or recently activated trigger
(including controlled dialogs opened with `showModal()`), outermost for nested layers; its name is
limited to the API's 120 visible characters. `anchorSelector.ts` avoids framework-generated React,
Base UI, Radix and Headless UI ids everywhere in a path. It saves up to three independently unique
alternatives in the existing comma-separated selector, favouring stable ids, role, aria-label and
identity data attributes; structure below a semantic ancestor disambiguates repeated controls.
Generated-id filtering applies only to ids, using bounded React tokens and numeric library suffixes; real JSF/PrimeFaces ids, reach-us and accessible labels remain semantic identities. State attributes are excluded. The complete selector remains at most 1,024 characters, including
openers and both ends of text selections. A purely positional path is used only without semantic
alternatives, so a moved portal cannot make a semantic match conflict with unrelated page content.
Multiple matches remain ambiguous; existing stored selectors still resolve without migration.

Trigger capture observes pointer and activation keys before page handlers, then associates only newly
opened layers in the next second. Native toggle event sources identify the actual invoker when several
buttons target the same popover. Capture accepts native open dialogs/popovers and aria-modal layers,
or dialog/menu roles activated by a trigger declaring popup/control semantics. Static grids, trees and
listboxes are never inferred from clicks; links and bare tabindex wrappers are not activation triggers.
Containing triggers are rejected, unrelated presses clear activation, and expanded aria-controls
relationships take precedence over captured triggers; this does not broaden which layers the toolbar host follows.
Explicit control relationships also work for layers that were already open when review started.
`getCommentPlacement` places a hidden or missing anchor with a `layer` on that opener while it is shown
and its layer is closed. Explicit aria-expanded always wins, including false for a mounted empty
listbox. Without it, captured layers and native open/popover state count; aria-controls alone requires
a natively open dialog or popover.
Missing content in an open layer stays missing. Areas are not outlined on an opener. Toolbar
layers nested on uier's own pages save every opener and place it on the first closed one
([toolbar-review.md](toolbar-review.md#openers-and-showing-a-comment-again)).
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

`e2e/anchor-recovery.spec.ts` covers static content after navigation, explicit collapsed state,
control precedence, activation clearing and generated versus real ids/labels.
`e2e/transient-ui.spec.ts` covers real Base UI portal remounts with regenerated ids and a removed
attribute alternative, reload recovery, multi-invoker native popovers and class-opened script dialogs.
`e2e/modal-dialog.spec.ts` covers showModal() trigger capture and closed-dialog pins on desktop/mobile.
`e2e/toolbar-anchors.api.spec.ts` checks semantic selectors, legacy selectors, restricted attributes and
length limits. Attribute selectors use exact, quoted values for role, aria-label and the identity data
attributes listed in `anchorSelector.ts`; the API keeps arbitrary attributes/operators out.
