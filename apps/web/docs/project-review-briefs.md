# Project review briefs

`DbProject.brief` is optional plain text, trimmed/cleared by `projectBriefSchema` with the shared
`MAX_PROJECT_BRIEF_LENGTH` (2000). Only admins edit it through `saveProject`; non-admin settings hide
the form. `getReviewInfo` allowlists it only when `canComment`, with environments. Never expose it in
invited signed-out or comments-off responses. The toolbar renders literal text and line breaks.
`GET /api/visitor?path=...` returns the current page's app-feedback privacy using
`isPrivateAppFeedback`; it contains no copied client path heuristic.
