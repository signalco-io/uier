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

## Resolving positions

`hooks/useCommentItemRects.tsx` resolves positions to rectangles and pin placements. Offsets are verified, then
a lazy, whitespace-free page index is shared by every comment, with one record per text node. Exact, restored,
missing and ambiguous results persist until the DOM version changes; geometry and visibility are remeasured on
layout frames (the versions are `hooks/useLayoutVersion.ts`). No pin for a missing, ambiguous or hidden anchor
(the saved opener of a closed layer is the one fallback, above), and it never throws.

## Anchors for change previews

`proposalPreview.ts` reads and replays point text against the element's whole visible label. An old
label that survives as a substring of a longer label is stale. Text selections require the complete
saved selection at valid offsets in uniquely matched elements. Replay verifies the original label or
selection and the computed values of every proposed property before it applies any change. Page and area
anchors, toolbar UI, forms and editable content are ineligible.

Point suggestions with structural selectors also check the target's label. When the reviewer picks
the element, the toolbar fingerprints its complete, bounded visible label if that label distinguishes
it from elements on the same path with different ordinals. The point stores only the fingerprint.
Replay requires the exact selector and label to agree and the label to remain unique within those
paths. A legacy point suggestion can use its original text or a stable selector identifying the
target itself. A legacy CSS-only suggestion on a structural selector stays available in Exact values.
The same identity check runs during a preview and uses the original text of nodes edited by uier.

Selected text can match its exact source or the rendered quote after CSS whitespace collapse. The
resolver preserves nonbreaking spaces and requires exact source text for whitespace-preserving
content. Legacy rewrite quotes can also use the verified quote with outer collapsible whitespace
trimmed. The engine maps the changed portion of the quote to raw text offsets, which preserves
unchanged indentation, line breaks and spaces when it edits the existing nodes. A replacement may
span adjacent text nodes. When the changed words would need to be reassigned across markup
boundaries, the proposal is unavailable.
The internal `trackPreviewTextRange` helper gives the pin and selection highlight the edited range,
including a caret-sized position for a deletion, until the preview stops.

Only one preview can be active. The engine applies allowlisted literal CSS values as inline
declarations and restores their original values and priorities. An authored inline shorthand must
expose each affected declaration through the CSSOM so it can be restored independently. The engine
settles transitions on its edited properties when applying and restoring them, so the original is
ready for capture or immediate replay. Unrelated transitions continue and event listeners stay
attached. The engine observes the edited nodes and restores the parts it still owns. New text written
by the page and unrelated inline edits survive cleanup. A replacement node stays under the page's control. The
toolbar calls the returned cleanup when its preview UI goes away.
[`proposal-preview-engine.spec.ts`](../../../apps/web/e2e/proposal-preview-engine.spec.ts) covers the
browser-side contract.
