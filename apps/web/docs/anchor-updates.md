# Anchor updates

`PATCH /api/comments/<id>/anchor` and the matching project review route validate selectors with the
existing schemas and call `comments/reattachAnchor.ts`. It enforces the saved page key and anchor revision
on each ETag retry; project updates also require author/admin rights and the original allowed origin.
Retain the original and immediately previous position plus change time/count in `anchorContext`, without
actor identifiers. DTOs allowlist its fields. It follows comment visibility and retention; no image or
message is replaced. Keep the privacy policy and toolbar guide aligned with this context.
