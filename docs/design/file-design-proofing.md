# File and design proofing implementation plan

Proposed on 19 November 2026. A project member shares an unpublished design, collects
feedback at exact locations, publishes revisions under the same link and obtains a decision
on the version to deliver. A client can complete the entire review on a phone. The scope
includes images, multi-page PDFs, Figma frames, videos, marketing emails and HTML prototypes.

## Build on the current review workflow

**One pin is one existing uier thread.** Keep its number, conversation, privacy, assignees,
statuses, notifications and inbox entry across revisions. Extend the thread with a file
location. Its original location always opens the evidence the reviewer saw. The web app owns
the viewer and loads each renderer on demand. The injected toolbar and extensions continue
to use their existing website entry points.

**“Changes ready for you to check” is a view of existing fix verification.** The owner of the
transition is [changeFixVerification](../../apps/web/src/lib/review/fixVerification.ts).
The app and toolbar already have [verification controls](../../apps/web/src/components/app/comments/VerificationControl.tsx)
and a [shared display contract](../../packages/toolbar/src/verification.ts). The toolbar
already places evidence next to a decision when [rechecking a page finding](../../packages/toolbar/docs/page-checks-verify.md).
Use that pattern for before-and-after file evidence.

1. From the original thread, a member uses **Request verification**, chooses the eligible
   reviewer and identifies the revised detail. Extend the existing request schema with an
   optional structured evidence reference containing the asset, original and target version
   IDs, and the corresponding locations. Validate both ends against the authorized thread
   and asset. Resolve preview URLs on read. Existing summary and fix-link requests keep working.
2. Add a paged, indexed project query for open, unarchived, pending requests addressed to the
   current reviewer and scoped to the selected asset/version. Count with the same visibility
   predicate. Use the server-side reviewer identity, including the original guest identity.
   Someone can be the reviewer without being the assignee. An upload alone creates zero requests.
3. The guest link, notification, or member inbox opens the same thread with its original
   request and revised detail aligned. **Confirm fix** and **Still needs work** call the existing
   confirm/reject actions with the current request revision and retry key. Reuse existing
   authorization, status changes, activity and notification receipts. Advance to the next
   pending request after success, retaining keyboard focus. On conflict, reload the thread
   and show the current request or decision. A mobile reviewer can switch versions while
   keeping the same detail in view.
4. Bind each check to the requested revision. If v3 arrives during a v2 check, identify v2
   in both the action and evidence and offer a link to v3. If a member requests a new check
   against v3, the replaced request's action must conflict. A v2 confirmation records the
   existing thread outcome and attests only to the evidence for v2.
5. Honor the [project opt-in and permission rules](../../apps/web/docs/fix-verification.md).
   With verification off, suppress the queue and its reminders. Turning it back on resumes
   eligible pending checks. Preserve self-review restrictions, explicitly attributed admin
   overrides, cancellation, and ordinary Done. MCP and integration status updates retain their
   current authority. They cannot supply human confirmation.

**Whole-version approval is a separate decision.** A named approver can approve a version
with zero threads or request changes with an explanation. Closing every thread leaves that
decision outstanding. Require at least one named approver to start sign-off. Bind an invited
external approver to a verified identity, so forwarding the general comment link cannot
transfer their decision. A new version requires fresh approval. A historical decision keeps
its exact file, version, reviewer, outcome and time while the project retains the review.

## Storage, access and compatibility

| Record or boundary | Implementation contract |
| --- | --- |
| Project and asset | Add **Files** to projects. Support file-only project creation before a website exists. [Project address validation](../../apps/web/src/lib/app/projects.ts) currently requires a site. Give file-only projects an explicit path through setup, install, review links, settings and first-site addition. An empty address list grants zero website origins. Use stable asset IDs and optional ordered collections. |
| Version | Keep original bytes and generated previews in private Azure Blob Storage. Keep metadata, digest, processing state, format-specific page/frame manifest and current published version pointer in Cosmos. Store project-owned records in the project partition, with distinct document types. Audit existing comment queries, counts and cleanup for mixed record types. Make accepted bytes immutable and publish with an expected-version check. |
| Upload and processing | Reuse the [recording upload and playback patterns](../recordings.md) for scoped grants, finalization, validation, private reads and cleanup. Give proofs their own upload policy, limits and lifecycle. Stage bytes, check actual format/size, create previews, then publish. Make finalize and background retries idempotent against the same version. A failed upload leaves the previous version available. |
| Comment location | Extend the [comment schema](../../apps/web/src/lib/db/schema.ts) with an optional typed asset target and immutable source location. Store normalized coordinates relative to a specific page/frame, text quotes or time ranges as appropriate. Store correspondence to another version separately. Website records without the new field retain their current meaning. Scope legacy site feeds to website feedback and add asset support explicitly to app lists, direct links, exports and MCP. |
| Sharing | Distinguish a stable link to the latest published version, a permalink to a version, and a thread link. Allow sharing one asset or collection with view, comment, named approval and optional original-download permissions. Check project policy, grant scope and thread privacy on every read or write, including previews, old versions, search counts, notifications and exports. Revocation invalidates the review link and fresh media grants. Use expiring media URLs and document their maximum residual lifetime. |
| Review round | Store required and optional reviewers, deadline, reminders, pause/close state and decisions against an immutable version. Derive approval from explicit decisions of all required reviewers and surface pending, changes requested, or approved. A pending required reviewer stays visible after another approves. Serialize decisions against the round/version being viewed and deduplicate retries. Track revised decisions and the actor who changed them. |

Keep acceptance fixtures in both the memory and Cosmos adapters. Cover project transfer,
deletion, redaction and grant revocation for versions, previews, originals, shares and pending
jobs. Private files and links require the same visibility checks when opened through an
integration as they do inside uier. Share an authorized uier permalink with issue trackers.
Extend the [review service and visibility checks](../../apps/web/src/lib/review/comments.ts)
and the [query predicates](../../apps/web/docs/comment-query.md) together. A scoped file
invitation must authorize only its assets, even when the caller supplies a thread ID directly.
Refresh that authorization inside conditional writes and before serving a retried receipt.

## Deliver in dependency order

| Milestone | Work and dependencies | Exit evidence |
| --- | --- | --- |
| 1. Asset lifecycle | Introduce file-only projects, format manifests, immutable versions, upload receipts, private storage, processing jobs and member/guest access. Exercise a single image through the whole path. | A member uploads, shares, revokes and deletes an image. A failed or repeated publish preserves the last good version. Concurrent publishes cannot replace one another silently. |
| 2. Shared viewer and threads | Build the asset library, collection sharing, viewer, spatial pins and accessible comment list on milestone 1. Integrate the normal composer, replies, drawings, statuses, assignment, inbox and deep links. Start with images and PDFs using the contracts below. | A guest pins a price on a PDF, a member opens it from the inbox, and both land on the same detail at different zoom levels. An asset-only guest cannot enumerate sibling assets or see private notes. |
| 3. Revision comparison and returning review | Build version history, location matching, synchronized comparison and the existing verification integration described above. Use explicit reattachment when a match is uncertain. | Inserting a cover moves a price from page 3 to page 4. The original pin still opens v1. The named reviewer sees the corrected price in v2, rejects or confirms it on the original thread, then advances to the next requested check. |
| 4. Remaining viewers and sources | Add Figma import/resync, video processing, email ingestion and HTML hosting on milestones 1–3. Implement each viewer's format-specific locations, comparison and recovery. Extend scoped MCP tools to upload versions and return ordinary thread links. | Each format passes its round trip below with a real source or representative file in preview. A revoked import credential or failed conversion reports the cause and preserves the last published review. |
| 5. Sign-off and delivery | Implement named approval rounds, deadlines, reminders, pause/close, version decisions, collection overview and a downloadable review record. Reuse existing delivery and permission services. | Two required reviewers decide independently. A new revision opens fresh decisions. A permitted export identifies the approved original, reviewer decisions, comments and timestamps. A guest export excludes internal notes. |
| 6. Design to staging | Pair an approved frame or page with an authorized staging URL and viewport. Place an aligned overlay or side-by-side view beside the live review. A discrepancy creates a normal live-site thread linked to the approved reference, with the same fix-verification path. | A designer flags a staging mismatch at the intended viewport. The developer and requested reviewer can return to the approved reference. Each side independently enforces access. |

### Viewer contracts

All viewers support general feedback, deep links, zoom or playback as appropriate, a clean
view with pins hidden and a keyboard-operable comment list. Keep the shared controls and thread
components in the app's UI kit and translate the new app/guest controls through the existing
catalogs. Keep heavy PDF, media and diff code out of the website toolbar and ordinary inbox.

A guest link opens on the work and the action requested. A designer opens to unresolved
threads with the current revision selected. The project owner sees a collection's files,
decisions, deadlines and outstanding reviewers together. Preserve a direct link's exact
destination for all three roles. For long comparisons, let the reviewer resume at their
next pending request on either device after establishing the same reviewer identity.

| Material | Input, anchors and revision behavior | Acceptance case |
| --- | --- | --- |
| Images | PNG, JPEG, WebP, SVG and animated GIF, singly or as a set. Support point, region, drawing, fit/original size and animation pause. Preserve orientation and aspect ratio. Render SVG through a safe derivative. Provide synchronized pan/zoom and opacity overlay on comparable revisions. | The same logo detail can be found after resizing the window, rotating a phone and switching versions. |
| PDFs | Page thumbnails, page jump, search for selectable text, quoted replacements, drawings and region pins for scanned pages. Retain page identity using content and text evidence across reorders. Offer side-by-side pages, aligned overlay and text changes when a text layer exists. | Insert a cover, reorder two pages and remove a page. Recover the uniquely matched detail, flag ambiguous matches and keep the removed page readable on the old version. |
| Figma | Authorize the design source, paste a file link, select frames and import snapshots with frame IDs and source links. Resync into a new immutable version and report added, renamed or removed frames. Access to imported frames follows the uier share. | A client reviews only the selected screens. A rename still compares with the original. A deleted frame retains its original thread and evidence. |
| Video | Accept MP4, MOV and WebM with a documented codec matrix. Generate playable derivatives and thumbnails, support seeking, playback speed, frame stepping, loops and time-range or spatial comments. Store media time independent of player size. | A link opens the requested moment and region. A clip trimmed before that moment prompts the author to confirm or update the proposed correspondence. |
| Marketing email | Accept an EML upload or a test send to a rotatable review address. Render safe HTML and plain text with subject, preheader, sender and link destinations. Provide wide/narrow previews and in-place copy suggestions. Route a later test send to the intended asset and deduplicate mail retries. | A client comments on the subject and a CTA. After a new test send, both versions can be inspected with tracking requests and active content disabled. Label previews with their actual rendering mode. |
| HTML prototypes | Accept a single HTML file or a directory/ZIP with local CSS, JS and images. Serve each revision on an isolated origin without app cookies. Let reviewers browse supported interactions and pin a page, element, selection or captured state. Apply bundle/processing limits and show a captured reference for states that cannot be restored. | Open a menu in a bundled prototype, leave a pin, upload v2 via an authorized agent and reopen v1. Both revisions are reachable from the same review. The prototype cannot access the uier session. |

## Release and verification

- **API and persistence.** Extend [verification API coverage](../../apps/web/e2e/verification.api.spec.ts)
  with authorized before/after references, wrong asset/version/reviewer, disabled verification,
  stale decisions, retries and two open tabs. Exercise old website requests and non-confirming
  bulk/provider writes. Verify real private Blob and Cosmos behavior in preview, including
  large uploads, cleanup after a worker restart and exact reviewer counts beyond the first page.
- **Browser and usability.** Run the brochure journey on desktop, touch and keyboard alone.
  Extend the [existing verification browser suite](../../apps/web/e2e/verification.spec.ts).
  Exercise blocked originals, unavailable targets, keyboard focus after a decision and recovery
  after session expiry. With first-time clients, measure time to first pin, time to verify
  three changes and wrong-version decisions. Record upload size, page count, device and
  first-preview/seek timings before choosing limits and performance budgets.
- **Rollout.** Qualify the complete flow in preview with separate storage, Figma credentials,
  inbound email and isolated HTML hosting. Route infra changes through CI. Enable qualified
  formats by project, observe conversion failures, storage growth and review completion, and
  keep existing proofs readable if new uploads for a format are paused. Publish a capability
  on uier's comparison pages after its deployed member and guest journeys pass. The full
  proofing claim requires all six formats, returning review, version sign-off and handoff.

Competitive references for this scope include [BugHerd file and Figma imports](https://support.bugherd.com/en/articles/11430387-uploading-and-managing-websites-and-files),
[ruttl file review](https://www.ruttl.com/online-pdf-annotator-markup-software),
[Pastel's HTML workflow](https://help.usepastel.com/en/articles/17629923-get-feedback-on-html-files-upload-directly-from-your-ai-agent),
[email](https://help.usepastel.com/en/articles/6247150-review-marketing-emails-in-pastel),
[video](https://help.usepastel.com/en/articles/12084757-review-videos-in-pastel),
[version approval](https://usepastel.com/blog/approvals) and
[Filestage's comparison viewer](https://help.filestage.io/en/articles/5560093-compare-versions-of-a-file-directly-in-the-viewer).
