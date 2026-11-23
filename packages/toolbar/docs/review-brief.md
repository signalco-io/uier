# Review brief

`ProjectGate` passes fresh access and optional brief through `useProjectViewer`. Keep customer
retention claims out. Reviews have no first-run guide; the brief is in the inbox header only. The
landing hint's dismissal is browser-local (`uier:showcase-hint-dismissed`, boolean only). Feedback
mode must keep its requested form focused on mount. Briefs render only as text nodes with preserved
line breaks. No linkification or rich text.

The UI kit's CSS source scan covers `@uier/ui-primitives` (`src/index.css`); add a `@source` line
when importing from another kit package that has class names. Lightning CSS merges
equivalent rules before CSS injection; unused shadow-root `@property` registrations are removed,
but retain the unconditional properties fallback. All review shadow roots share one constructed
sheet; do not add plain style elements or require the host's `unsafe-inline` permission.
