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
| PDF | A published `application/pdf` artifact supplies real canvas pages, selectable text and scrollable thumbnails. `manifest.pdf.artifactId` can designate it explicitly. PDF.js and its worker load on demand. The build publishes the pinned package's CMaps, fonts and decoder WASM under `/proof-pdf/<version>/`. Text selection creates a quote anchor; repeated quotes need an explicit spatial anchor for exact visual placement. Reordered pages pair on unique content or text evidence. When the match is ambiguous or the page changed, the reviewer can select the reference page. The diff presents removals and additions in version order. |
| Figma | Each imported frame uses its stable surface ID, dimensions, label and raster artifact. The comparison follows a matching frame ID even after rename, and shows an absent frame explicitly. An optional HTTPS `surface.sourceUrl` to Figma is displayed to members. |
| Video | A surface or version exposes a playable MP4 or WebM derivative. `durationMs` bounds time and time-range anchors. Optional `manifest.video.frameRate` controls the step increment. The viewer seeks to the saved timestamp and can apply the time to a paired version. Spatial regions and timed ranges use their respective anchor types. |
| Email | A published HTML or plain-text artifact supplies the body. Optional `manifest.email` supplies subject, preheader, sender and `plainTextArtifactId`. Wide and narrow set distinct logical iframe widths. The viewer keeps HTML in a scriptless opaque sandbox, removes navigation targets and remote resources, and lists link destinations as text. The plain-text body and metadata support quote anchors. |
| HTML prototype | The viewer requests an authorized, version-bound URL from `GET /assets/:assetId/versions/:versionId/prototype`. It mounts that URL only on the configured origin `NEXT_PUBLIC_UIER_PROOF_HTML_ORIGIN`. The frame runs scripts in an opaque sandbox. Its bridge lets a reviewer pick an element or quote selected text on a page in the version’s manifest. Navigation stays inside the sandbox. A raster derivative can supply a captured view. The saved point locates the viewport coordinate. Reopening an exact interactive state requires a published capture of that state. |

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
second rendered page, and reopens that exact quote through the thread permalink.

The two-thread [verification spec](../e2e/proof-verification.spec.ts) places revised locations on the
same point on touch and checks focus when the reviewer advances. Placement and pan own pointer
input while active. Pins open their threads in Browse.
