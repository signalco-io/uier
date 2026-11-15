# Use-case pages

The public acquisition pages explain three distinct situations:

- `/use-cases/client-feedback`: a client review round, project and client grouping, a brief,
  invited/guest access, discussion, ownership and handoff.
- `/use-cases/bug-reporting`: a reproducible website finding with expected/actual behavior, steps,
  environment, chosen evidence and developer handoff.
- `/use-cases/user-acceptance-testing`: a manual acceptance round with agreed journeys, separate
  environments, findings, not-checked areas, individual fix checks and a team release decision.

`src/lib/useCases.ts` owns their titles, descriptions and paths. Each static route reuses
`ContentPage`, public UI-kit buttons and existing decorative product specimens. Its social image
reads the same catalog entry. Keep the content substantive in the initial HTML, use sentence case
and semantic brand tokens, and do not add an animation or a new client bundle for these pages.

## Sources and boundaries

Keep project/site access, client grouping, review links, guest identity, assignment and environments
with [the review workflow](../../../docs/review-workflow.md), the review-brief note and the relevant
feature pages. A client label never grants access. The restaurant scenarios are fictional examples,
not customer evidence, measured results or automated test output. Review observations and team-level
release decisions are team practices; uier records findings and thread decisions.

`/features/pinned-comments` remains the canonical annotation explanation. It links the use cases;
the client-review guide does too. Do not duplicate it at `/features/website-annotation` or
`/use-cases/website-annotation`, or create a second UAT page at `/use-cases/website-uat`.

Capture copy follows [screenshots](../../../docs/review-workflow.md#screenshots),
[recordings](../../../docs/recordings.md) and the Screenshots and context feature page. Capture is
an attempt; the composer has no screenshot preview. Attach screenshot can omit the image before
posting, while Redact screenshot edits an already saved image and cannot recall earlier copies.
Explicit screen recording is not automatic session replay, console-log capture or network recording.
Keep the 60-second/25-MiB limits, video-only built-in capture, uploaded-audio/metadata caveat,
navigation/browser/policy limits and absent video redaction accurate.

Status labels can be customized within the supported categories. Guest responses do not expose
workspace/project workflow definitions. Fix verification follows [its area note](fix-verification.md):
off by default, an admin enables it for a project, then a member requests an optional check on an
individual thread. A chosen reviewer confirms; another admin's decision is labeled as an override.
Ordinary Done, bulk Done, connected-service closure and MCP status never imply reviewer confirmation
or release sign-off. The existing verification specimen depicts an enabled project.

## Registration and verification

Register pages in KnownPages, footer/contextual navigation, the public inventory and the existing
SEO/social-card checks. The normal static sitemap and search-index pipeline discovers them; no
new routing or analytics mechanism is needed. Unknown and superseded unshipped route suggestions
remain real 404s. After deployment, verify the exact revision, live pages, canonicals, links,
sitemap and advertised images before recording publication complete.

`e2e/use-case-pages.spec.ts` covers distinct worked examples, access/capture/verification boundaries,
the journey from annotation to bug reporting and UAT, keyboard links, narrow layout and light/dark
accessibility. `e2e/use-case-pages.api.spec.ts` checks route metadata, substantive initial HTML,
route-specific social images and unpublished-route 404s. Run them on API, Desktop Chrome and
Mobile Chrome after a fresh production build, with `PLAYWRIGHT_FULL=1` and `--retries=0`.
