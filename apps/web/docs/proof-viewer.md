# File library and reviewer viewer

The member library lives at `/app/projects/[publicId]/files`. A member going there
with the project's internal code is redirected to the public identifier. Comments
and settings keep their existing app routes. In Create project, **Files only**
requires a project name and stores an empty address list. No website origin is
granted. To add the first site, use Files → Add a site address. That save uses the
same address normalization and origin scoping as a website project. If another
tab has already added a site, the first-site form asks the admin to reload.

## Client contracts

- `FileLibrary({ projectId, guestSharing, reviewSettingsHref?, siteSettingsHref? })`
  receives the public ID and navigation hints from the signed-in page. It reads
  the library and enabled formats from the [proof API](proof-api.md). It sends
  the chosen bytes with the upload grant's headers, then finalizes the returned
  version ID. A retry retains the upload request ID while the same file is
  selected. Only published versions get viewer links. File and collection
  positions order the library and collection viewer. Guest link creation and
  revocation use the same API, so access follows the current project policy.
  Admins can enable source formats. Figma import and resync use the supplied
  credential for frame discovery and publishing through the authorized API.
  For email, a member can upload an EML or create a file and rotate its test
  address when ingress is configured.
- `ProofViewer({ projectId, assetId, initialVersionId?, initialThreadId? })`
  accepts the public ID and the route's `version` and `thread` query keys.
  A bare asset route reads the current published version. Permalinks carry the
  immutable version, and can carry the thread. The viewer exchanges a share
  fragment before reading scoped data and strips it from the address. Collection
  links use `/proof/[publicId]/collection/[collectionId]`. Both viewer pages use
  the viewer's app language, deny indexing and send no referrer.
  Reopening a grant link in the same tab reloads the proof page when only the
  fragment changes. The normal exchange restores the link's scope and keeps the
  reviewer cookie. The reload reads the current file version or collection
  membership and refreshes the review queue. Version and thread query parameters
  continue to open the saved permalink.
- `ProofThreads` stays mounted when switching version or choosing a revised
  location. See [the thread interface](proof-review.md#viewer-mount) for its
  props. The viewer sends `draftAnchor` on the selected version and renders
  the authorized locations it receives in `onThreadsChange`. An explicit
  thread permalink resolves the selected thread even when it lies outside the
  first list page. `onJump` restores the saved version and surface. `onEvidence`
  selects the requested side and opens its paired location as the reference.
  The evidence side's geometry and time come from its own saved location.

## Rendering

`ProofViewport` maps coordinates against the displayed surface, excluding the
viewport gutters. It accepts `projectId`, `version`, a zero-based `index`, `zoom`, optional
`focus` and `draftAnchor`, and callbacks for selection, authorized pins and
synchronized normalized scroll. The reviewer can drag to pan, scroll, use Fit
or 100%, and hide pins with the thread list still available. A reviewer using
the keyboard can focus the viewport, move a location with the arrows, and
commit with Enter. Region and drawing tools use two keyboard points. The
version and surface IDs live in the manifest, independent of screen size.

| Format | Browser input and behavior |
| --- | --- |
| Image | `surfaces[index].artifactId` names a safe raster derivative. The image processor's animated WebP carries animation duration, so the viewer can pause, play and step decoded frames. SVG uses a raster derivative. |
| PDF | A published `application/pdf` artifact supplies real canvas pages, selectable text and scrollable thumbnails. `manifest.pdf.artifactId` can designate it explicitly. PDF.js and its worker load on demand. The build publishes the pinned package's CMaps, fonts and decoder WASM under `/proof-pdf/<version>/`. Text selection and the keyboard- and touch-operable text picker create quote anchors. A saved occurrence distinguishes repeated copy when the text layer can identify it. A reviewer can suggest a replacement on that anchor. Reordered pages pair on unique content or text evidence. When the match is ambiguous or the page changed, the reviewer can select the reference page. The diff presents removals and additions in version order. |
| Figma | Each imported frame uses its stable surface ID, dimensions, label and raster artifact. The comparison follows a matching frame ID even after rename, and shows an absent frame explicitly. An optional HTTPS `surface.sourceUrl` to Figma is displayed to members. |
| Video | A surface or version exposes a playable MP4 or WebM derivative. `durationMs` bounds time and time-range anchors. Step backward and forward use the published frame rate, with a default increment for older media without that metadata. A spatial point or region stores its time in the same anchor. Select a time range first to keep geometry visible throughout that interval. A revised clip shows the original separately and lets the reviewer seek to the match, confirm the proposed position or place a new pin before saving a correspondence. |
| Email | A published HTML or plain-text artifact supplies the body. Optional `manifest.email` supplies subject, preheader, sender and `plainTextArtifactId`. Wide and narrow set distinct logical iframe widths. The viewer keeps HTML in a scriptless opaque sandbox, removes navigation targets and remote resources, and lists link destinations as text. Subject, preheader and sender have their own anchors. Use the body text picker or select copy in plain text. The calls-to-action list identifies individual link labels in Safe HTML. A replacement suggestion continues in the file thread and shows the original, proposed and revised copy when the revised location is text. |
| HTML prototype | The viewer requests an authorized, version-bound URL from `GET /assets/:assetId/versions/:versionId/prototype`. It mounts that URL only on the configured origin `NEXT_PUBLIC_UIER_PROOF_HTML_ORIGIN`. The frame runs scripts in an opaque sandbox. Browse the bundle and use **Pick a prototype element** to click, tap or press Enter on a focused element. Alt+Shift+A starts picking from inside the frame without moving focus. Select text in the frame and use **Use selected text** to quote it. Deep links reopen the selected revision and page and check the saved element and text. Native details and popovers can be reopened. A custom menu or other state that no longer matches opens its captured labels and layout. The reviewer can still browse the original bundle. The captured reference represents the reviewed detail as text and boxes. |

The paired layout shares zoom for comparable surfaces. The opacity overlay is
available for raster, PDF and Figma surfaces with matching aspect ratios.
Before-and-after evidence can show independently aligned locations even when
the format or page geometry differs.

[`proof-viewer.spec.ts`](../e2e/proof-viewer.spec.ts) covers file-only setup,
first-site addition, uploads, animation, guest pin placement, immutable permalinks,
comparison and revocation on desktop and touch. The PDF renderer fixture uses
real PDF bytes with synthetic asset metadata so canvas, text and page pairing
are exercised even when new PDF uploads are paused. The published PDF test
also enables the format, uploads a PDF through the library, selects text on the
second rendered page and reopens the replacement suggestion at its exact quote.

The two-thread [verification spec](../e2e/proof-verification.spec.ts) places revised locations on the
same point on touch and checks focus when the reviewer advances. Placement and pan own pointer
input while active. Pins open their threads in Browse.

## From an approved design to staging

Open **Design to staging** in a published file's viewer, on the PDF page, Figma
frame or image to compare. After all required reviewers explicitly approve that
version, a project member can pair it with an address on one of the project's
origins. The width and height are the intended CSS viewport pixels. The address
must follow the project's [page state policy](review-api.md). The Files library
opens the regular viewer for each version. A discrepancy's **Approved design**
link opens the exact version and surface, even after a newer version is published.

**Open paired live review** starts the usual website toolbar on the actual staging
page. **Compare approved design** places the approved reference over the live page,
aligned from the document origin at the saved width. The overlay scrolls with the
page. The control shows both viewport sizes when they differ. Resize the browser or
choose a matching device viewport for a responsive comparison. When the site blocks
outgoing frames, the same control offers a first-party approved design link to open
beside the live page. Staging can deny being framed by other sites.

**Report discrepancy** uses the usual point or area composer. The linked thread has
the same number, status, review permissions and notifications as website feedback.
The paired surface lists links to its staging discrepancies. To document a fix,
attach a screenshot of the updated staging page to a reply, then select that reply
image when requesting verification. The original screenshot and the selected reply
image appear next to the request, subject to the usual screenshot permissions and
later redaction.

The [staging review API](proof-review.md#design-to-staging) describes the access and
retention rules.

[Browser import journeys](../e2e/proof-imports.spec.ts) cover a custom prototype
menu and a restorable native menu, an agent publishing version 2, and a
separately authorized guest returning to version 1 before the share is
revoked. They also check video pin geometry and timestamps after resize,
reconfirmation after a one-second trim, and subject, CTA and body suggestions
through the before-and-after viewer on desktop and touch.
