# Review brief

`ProjectGate` passes fresh access and optional brief through `useProjectViewer`. Keep customer
retention claims out. Reviews have no first-run guide; the brief is in the inbox header only. The
landing hint's dismissal is browser-local (`uier:showcase-hint-dismissed`, boolean only). Feedback
mode must keep its requested form focused on mount. Briefs render only as text nodes with preserved
line breaks. No linkification or rich text.

The composite UI CSS source scan covers only `Timeago`, the sole `@signalco/ui` import. Add another
component's source if importing one; primitives retain their full source scan. Lightning CSS merges
equivalent rules before CSS injection; unused shadow-root `@property` registrations are removed,
but retain the unconditional properties fallback. All review shadow roots share one constructed
sheet; do not add plain style elements or require the host's `unsafe-inline` permission.
