# Feature pages

`/features/<feature>` pages describe one shipped workflow each, with the shared marketing building
blocks, a static specimen built from the tokens (`TriageSpecimen`, `FixVerificationSpecimen`, `AiSpecimens`, `ChecksSpecimens`),
`publicPageMetadata` with their own path and a page card with the section Features
([social cards](social-cards.md)). Page-level questions use `FaqPanel` from `LandingFaq`.
There is no `/features` index; any other slug is a real 404. Publish a feature page only once the
workflow is deployed to production, with labels and actor rules taken from the delivered controls,
link it from the landing (its tile, the details or questions) and the footer, and add it to `KnownPages` and to
the public paths in `e2e/seo.api.spec.ts`, `e2e/social-cards.api.spec.ts` and `e2e/footer.spec.ts`.

Every tile of the landing's "What it does" has a page, and the tile is one link to it ([landing page](landing-page.md)):
pinned comments, screenshots, threads, the inbox and the board below, page checks, `/integrations` and AI. Those pages
have an animated cover under the header (`src/components/marketing/covers/`): one loop of the feature on the example
site through the shared `FeatureCover`, which follows the [integrations cover](integration-pages.md)'s rules (a picture,
`inert` and `aria-hidden`, plays only in view, Pause, one still frame and its own caption with reduced motion, a fixed
height per breakpoint and captions in one grid cell). A cover copies the shipped controls like the specimens do and
shows only what its page says; check it at 390 px, where everything must stay inside the canvas. `useBoxes` measures
where the pointer and moving parts go, so a cover follows any width. Feedback triage and fix verification have no cover:
no tile of their own. `e2e/feature-overview-pages.spec.ts` covers the tiles' links and hover, the five pages' sections,
links, covers (Pause, the reduced-motion still frame, a loop that moves nothing below it) and accessibility;
`e2e/feature-pages.api.spec.ts` their metadata and social cards.

`/features/pinned-comments` (`PinnedCover`) states pinning to an element, a dragged area or selected words, the pin
(number, message count, status dot, hover preview, Done leaving the page), what happens when the page changes (closed
layers' openers, no guessed pins, reattaching by the author or an admin) and Draw on the page, which projects can hide.
Its sources are the toolbar's point-mode, comment-thread, canvas-mode and anchor-recovery notes.

`/features/screenshots` (`ScreenshotsCover`, which draws the device details with the shared `DeviceDetails`) states the
screenshot attempt and Attach screenshot, that the composer has no preview, the members-only device details (guests see
the screen size; the user-agent string and IP address are never stored), recordings and attached images, Redact
screenshot and replacing an image, and what a screenshot can miss. Keep it with the toolbar's screenshots, recordings
and device-details notes and `docs/api.md`.

`/features/threads` (`ThreadsCover`) states replies from the page, the inbox and the app, the editor's formatting,
images, recordings, reactions and colour swatches, mentions and assignees, following and the five-minute email digest
(no comment text unless excerpts are on; never screenshots or browser details), guests' Email me replies, private
threads, who edits and deletes, and the 50-message thread limit.

`/features/inbox` (`InboxCover`) states the toolbar's inbox: the unread badge, the location picker (pages, sections,
environments), search, Assigned to me, the unread line, the status tabs, drafts, paging, environments and the app's
comments and My work. Keep it with the toolbar's inbox note and `docs/review-workflow.md` ("Feedback environments").

`/features/board` (`BoardCover`) states the four statuses, who may change them (members and the comment's author,
`canResolveComment`), the list, the board's drag, touch and keyboard moves, Ready to verify asking for the request,
Archive, the filters and My work. It links to fix verification and triage instead of describing them.

`/features/feedback-triage` states paged project feedback (including search over older authorized threads)
and the `MAX_TRIAGE_THREADS` action bound (50), the batch outcomes and the permissions; change the page with them.
Its bulk Done is ordinary completion and never reviewer confirmation: a pending check ends as "Done
without reviewer confirmation" (`@uier/toolbar/verification` labels). It links to
`/features/fix-verification` for the verification workflow rather than describing it.
`e2e/feature-pages.api.spec.ts` covers its metadata, social card and the 404s;
`e2e/feature-pages.spec.ts` its claims, links and accessibility.
Its final section links to `/compare` for teams deciding how to handle website reviews.

`/features/fix-verification` keeps a reviewer's confirmation apart from ordinary and bulk Done (it
links to the triage page for the latter), a connected service's closure and MCP status; change it
with the verification controls and `src/lib/review/fixVerification.ts`.
Its "Where it helps" cards each carry an outlined `@signalco/ui-icons` icon through `Tile`'s `icon`
(20 px, 1.75 stroke); other feature pages have no use-case section.
`e2e/fix-verification-page.spec.ts` covers its copy, links, responsive layout and accessibility.

`/features/ai` covers the MCP connector for coding tools and rewrite suggestions. It offers only the
clients Account offers (`mcp/clients.ts`: Claude Code with browser sign-in, Codex and Cursor with an
access token), the operation labels of `components/app/mcp/scopes.ts`, the prompts of
`mcp/workflows.ts` and what the connector cannot do; change it with them and with
[docs/mcp.md](../../../docs/mcp.md). Approval of each write happens in the coding tool, never in uier, and
MCP never confirms a fix. Its rewrite section follows the toolbar's labels and the privacy policy's
"Rewrite suggestions". The landing links it from the "Let your coding agent fix it" tile (`AgentSpecimen`)
and the coding-agent question. Its cover (`AgentCover`) plays a coding agent calling the connector's tools by their
`server.ts` names, the thread going in progress with the agent under its assignee, then the agent's own approval question
before it links the pull request and requests verification. `e2e/ai-page.spec.ts` covers its copy,
links and accessibility; `e2e/feature-pages.api.spec.ts` its metadata and social card.
Its rewrite list and privacy answer also describe admin-saved workspace style guidance and project
additions/replacements ([settings pattern](project-settings.md#workspace-defaults-and-project-settings)).
The settings remain private to admins; the reviewer still supplies their own optional instruction.

`/features/page-checks` covers the toolbar's Accessibility and SEO panels and the app's Page checks view. Its
claims come from [the panels' notes](../../../packages/toolbar/docs/page-checks.md) and the `page-checks-*.md`
notes beside them (the background checks and their bounds: 1,500 elements, `Save-Data`; To review; Not an issue;
Comment on all; Reported as; the re-check in a thread; each section's checks), the panels' labels in
`packages/toolbar/src/components/checks`, [the view](page-checks.md) (members' reviews only, 200 pages, 90 days,
Across pages) and the privacy policy's "Page suggestions" for what reaches Anthropic. Change it with them. It says
what the checks cannot do (automated checks find only some issues, Core Web Vitals are this browser's, frames are
not audited) and that a check never changes a thread's status. Its pictures (the cover `ChecksCover`,
`SeoSceneSpecimen`, `PageChecksTableSpecimen` in `ChecksSpecimens.tsx`) reuse the panel parts the landing's tile
uses (`AccessibilityPanelSpecimen`, `SeoPanelSpecimen`); the cover points at the row's buttons by their `data-issue-*`; keep their text at `text-muted-foreground` contrast or
better, since the page's axe scan includes them. `e2e/page-checks-page.spec.ts` covers its copy, links, width and
accessibility; `e2e/feature-pages.api.spec.ts` its metadata and social card.
