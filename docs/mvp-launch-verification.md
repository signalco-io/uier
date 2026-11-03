# MVP launch verification

Evidence for [#90](https://github.com/signalco-io/uier/issues/90), part of
[#77](https://github.com/signalco-io/uier/issues/77). Updated October 25, 2026.

**The launch gate is open.** Local integration coverage is useful evidence, but does not establish
hosted delivery, physical-device usability or completion of the remaining MVP dependencies.
Issues #91/#92 and the other after-MVP work do not block this gate.

## Evidence matrix

| Requirement | Repeatable coverage | Remaining acceptance evidence |
| --- | --- | --- |
| Owner installation check → shared link → named guest → member reply → resolved direct link → guest reopens | `e2e/launch.spec.ts`, two isolated browser contexts and an actual second HTTP server; the generated installation/review/comment links are followed | Run on a separately hosted HTTPS site with real delivery/configuration; integrate unread and notifications first |
| Element, selected text, manual rewrite, page feedback and bug report | `launch.spec.ts`; existing `rewrite.spec.ts` also checks AI suggestions through the Anthropic stub | Real mobile selection handles and optional AI provider smoke |
| Automatic capture, no composer image, saved expandable thumbnail | `launch.spec.ts`, `screenshots.spec.ts`, `automaticCapture.api.spec.ts`, `screenshot.api.spec.ts` | Hosted origin/CSP/font and capture behavior on representative real pages |
| Mouse/touch drag and left/right docking; keyboard alternatives and persistence | `movement.spec.ts` sends browser touch through Chromium CDP; `launch.spec.ts` checks keyboard movement, docking, focus, persistence and bounds across engines | Physical iOS/Android pointer cancellation, browser zoom/safe areas and OS keyboard/orientation transitions |
| Collapse hides annotations and preserves draft/status | `launch.spec.ts`, `review.spec.ts` | Durable reload recovery depends on #86; collapse alone is not that evidence |
| Navigation, reload, meaningful query/hash routes and missing/changed/hidden anchors | `launch.spec.ts`, `page-state.spec.ts`, `page-state.api.spec.ts`, `anchors.spec.ts` | Combined durable-draft activity after #83/#86 merge; real app routing smoke |
| Fresh/unread activity from another reviewer | Owned by [#83](https://github.com/signalco-io/uier/issues/83), still open at this audit | Integrate its merged PR; verify own vs other activity, read vs resolve, focus/reconnect and revoked/private access in the combined flow |
| Optional guest reply email and authorized digests | Owned by [#84](https://github.com/signalco-io/uier/issues/84), still open at this audit | Integrate its merged PR; actual verified opt-in, batching/seen suppression, delivery/retry/deduplication, mute/unsubscribe and loss of access |
| Durable drafts and uncertain-submit retry | Owned by [#86](https://github.com/signalco-io/uier/issues/86), still open at this audit | Integrate its merged PR; abort the response after a real successful write, reload and retry with exactly one item; all draft scopes, expiry/discard/sign-out/storage failures |
| Guest, invited, comments off, revoked member and private comments | `project-review.spec.ts`, `users.spec.ts`, `editing-context.api.spec.ts` use real server permission checks, including screenshot access | Rerun after all dependencies merge; check fresh caches and notification delivery cannot expose newly hidden content |
| Keyboard, accessible names, axe, light/dark, reduced motion and host styles | `launch.spec.ts`, `showcase.spec.ts`, `embed.spec.ts`; launch screenshots are written to each test's result directory | Manual VoiceOver/NVDA reading order/announcements; physical touch target usability |
| Inactive/busy bundle, requests and host interactions | `launch-performance.spec.ts`, 100 real API-created threads (80 on this page, 20 elsewhere; 25 tiny saved images) | Repeat on hosted HTTPS with production refresh and capture; constrained CPU/network, sustained idle/background, realistic large images/DOM and larger projects |
| Feedback opening and capture on a long page | `launch-performance.spec.ts`, 250 sections (1,010 elements) under a sticky header and a fixed badge, scrolled to the middle, at normal and 4× slower CPU | Real long pages with large images and web fonts; physical low-end devices |
| Local and hosted checks, docs and dependency evidence | Required commands below; dependency receipts below | Record this PR's CI/preview and merge, then final merged dependency checks and hosted acceptance before closing #90 or checking #77 |

## Browser and environment scope

The local launch flows run against a production Next.js build on macOS 27.2 arm64, Node 24.15.0,
pnpm 12.15.0 and Playwright 1.64.1. They use the in-memory app/comments stores, local sign-in links,
the local BotID human bypass and the Anthropic stub. No email is sent and no Cosmos DB persistence
or production BotID challenge is demonstrated by these tests.

- Desktop Chrome and Pixel 5 profiles use Playwright Chromium **156.0.8078.4**. Pixel 5 means viewport, DPR,
  user agent and touch emulation; it is not a physical phone or Chrome's shipping Android binary.
- Desktop Safari and iPhone 13 profiles use Playwright WebKit **27.2**. These are engine/emulation checks,
  not shipping Safari or an iPhone. Their fixture uses `127.0.0.1` on a second port: cross-origin,
  same-site HTTP. Chromium also uses `reviewed.localhost`, a separate loopback site, for cross-site
  CSP and identity coverage.
- The installed Playwright Firefox 157.0 build failed before opening a page with
  `Could not find profile folder`, both with the OS temp directory and `/tmp`. Firefox acceptance
  remains pending. The project is available for reruns in a working environment; no skip pretends
  it passed.
- Text selection uses a real browser DOM Range created by the test. The smaller/landscape viewport
  checks emulate available layout space; they do not open an OS keyboard or rotate a device.
- Automated axe and keyboard checks do not establish screen-reader usability. No physical-device
  or manual screen-reader acceptance is recorded here.

## Performance methodology and budgets

`launch-performance.spec.ts` attaches `launch-performance.json` with exact engine version, byte
sizes, request paths, each timing sample and observed Chromium long tasks. It tests both desktop
and mobile Chromium profiles without CPU or network throttling. The fixture keeps a working host
button/input, and deliberately styles host buttons to detect style leakage. The small loader is
downloaded and parsed when a review is inactive. The separate review script,
styles and fonts load only when the review UI is needed; the loader still has a cost.

- Current loader limits are **7,500 raw bytes / 3,100 gzip bytes**. Historical measurements below
  describe the former single bundle. The review UI now loads separately; the request timing
  attachment includes that script. Compression is calculated from the built bytes, not a claim
  about CDN transfer encoding, cache hits or wire size.
- An inactive project review may make **one background session POST**, and **zero comment API/font requests**, in the load plus eight host clicks
  and a **1,200 ms observation window**. This is a short deterministic guard, not an all-day idle
  measurement.
- Opening the 100-thread inbox (it opens on this page's 80 threads; the test then picks All pages) may
  perform at most **four comment-list GETs**. Fewer than all
  **25 screenshot requests** must load before scrolling. These protect lazy evidence loading and
  bounded initial reads; the other observed request paths, byte sizes and timings are retained.
  Browser instrumentation may omit CORS preflights; cached requests can report unavailable/negative
  size fields, which must not be summed as real transfer bytes.
- After interaction, at most **two extra requests in 1,200 ms** are allowed as query/capture work
  settles. Long-duration foreground/background refresh budgets must be verified with #83.
- Each of eight host button keyboard activations per phase (inactive, busy inbox, capture and movement) must
  reach the next animation frame in **under 250 ms**. The measurement starts at the browser event's
  timestamp, not before an automation round trip. Keyboard activation avoids waiting for the host
  pointer target that the mobile inbox intentionally covers. It does not prove the covered page is
  pointer-interactive. Observed active-load/interaction long tasks must
  also stay under 250 ms. This is a severe-regression guard with scheduling headroom, not an INP
  percentile, real-device SLO, or proof that every capture frame stays within 16 ms.
- Tiny fixture images test lazy fetch behavior, not large image decoding. A small fixture DOM,
  loopback transport and local stores do not predict hosted network/storage latency. No claim of
  negligible bundle or capture cost is justified by this test.
- Capture observation waits for the real canvas encoder and records its elapsed time and the number
  of host events that actually overlap it. The trigger-to-encoder interval includes the automation
  click delay and asynchronous work; it is not main-thread blocking time. A zero overlap count must
  not be described as a concurrent capture interaction measurement. Chromium long-task samples cover
  work of at least 50 ms; an empty list means none was observed, not zero JavaScript work.

- Feedback capture (#319) is measured separately, in `capture-performance.json`: the short page, then
  `?sections=250` (1,010 elements) at normal and 4× slower CPU (Chromium CDP throttling). Each sample
  records **first frame** (click event to the animation frame after the composer's text box is added),
  **encoder completion** (click to the final WebP/JPEG encoding, not the 1×1 WebP probe) and **blocking
  time** (long tasks from the click to the encoding, each beyond 50 ms) as separate metrics. On the long
  page the first frame must be under **100 ms** at normal CPU and within 50 ms of the short page's, under
  **500 ms** at 4×; no long task after the first frame may reach **100 ms** (normal) or **250 ms** (4×);
  blocking time stays under **150 ms** / **500 ms**, and every capture finishes within **5 s**. These keep
  several times the local headroom and fail on the previous capture.

The release record must preserve the actual JSON measurements and limitations with the tested
revision. Repeat measurements after merged feature changes before accepting the launch gate.

The [committed local baseline](mvp-launch-baseline.json) contains three samples per Chromium
profile, on top of merged #102. The bundle was **678,985 raw / 197,959 gzip / 167,269 Brotli bytes**.
Every sample made two list reads, loaded one of 25 screenshots initially, and made zero additional
requests in the short idle window. The longest observed active task was **63 ms**.

| Profile (emulated, unthrottled) | Inactive max | Busy max | After capture trigger max | After movement max |
| --- | --- | --- | --- | --- |
| Desktop Chromium 156 | 16.8 ms | 22.8 ms | 17.4 ms | 16.7 ms |
| Pixel 5 / Chromium 156 | 17.3 ms | 32.5 ms | 16.9 ms | 15.8 ms |

These are maxima of the sampled browser click-to-frame durations, not population percentiles.
Trigger-to-encoder completion took 35–48.2 ms on desktop and 30.6–47.2 ms on the mobile profile.
**All six captures completed before the sampled host events (zero overlaps)**. The 250 ms guard
allows substantial CI scheduling headroom; concurrent capture and real-device responsiveness remain
pending, as do sustained refresh/network budgets after #83. Desktop/mobile light and dark launch
screenshots were visually inspected for thread layout, saved thumbnails and fallback-anchor copy.

## Local validation record

The measured source revision is `ced38022adc3975797a539afa919617aabd374ba` on top of `55c5088` (#102).
`pnpm typecheck`, `pnpm build` and `PORT=4714 pnpm test` passed: **all 289 tests, no retries**.
Six additional WebKit launch scenarios passed without retries, and all six isolated performance
samples passed. Firefox remains a startup failure, not a passing engine. Later receipt-only edits
to this document/report do not change the measured product code. Hosted CI and merge receipts
are recorded on #90 and the implementation PR.

## Reproduce

Use an isolated worktree, its own pnpm store and a free port. This issue uses **4714**; the stub
uses **5714**. Never reuse a running server or another chat's build/store.

```bash
pnpm install --frozen-lockfile --store-dir .pnpm-store
pnpm typecheck
pnpm build
PORT=4714 pnpm test
PORT=4714 pnpm test:full

# Install these once for the additional engines.
pnpm -C apps/web exec playwright install firefox webkit
PORT=4714 PLAYWRIGHT_FULL=1 PLAYWRIGHT_CROSS_BROWSER=1 pnpm -C apps/web exec playwright test launch.spec.ts \
  --project='Desktop Firefox' --project='Desktop WebKit' --project='Mobile WebKit' --workers=2

# Repeat measured Chromium samples separately to limit competing browser load.
PORT=4714 PLAYWRIGHT_FULL=1 pnpm -C apps/web exec playwright test launch-performance.spec.ts --workers=1 --repeat-each=3
```

The normal required suite runs every API test and tagged Desktop Chrome / Mobile Chrome essentials;
`pnpm test:full` runs all browser regressions. Extra engines are opt-in
because existing touch tests use Chromium CDP; the portable launch scenarios are their test target.
Every launched engine remains a real test with failures, not a swallowed exception.

## Dependency receipts and final pending checklist

The audit starts from `aadf5ff30b4fa84750d923926e90cda9482d4d9e` (fresh `origin/main`). Hosted
CI OK, web checks and Vercel preview were confirmed successful for these PR heads:

| PR | Implemented scope | Tested head → merge commit | Hosted check evidence |
| --- | --- | --- | --- |
| [#97](https://github.com/signalco-io/uier/pull/97) | #89 collapse hides page annotations | `0c8eaee` → `a48f831` | [CI OK and web/preview](https://github.com/signalco-io/uier/actions/runs/40155439035) |
| [#99](https://github.com/signalco-io/uier/pull/99) | #78/#79/#81 movement, docking, automatic captures | `120aa09` → `09efbe9` | [CI OK and web/preview](https://github.com/signalco-io/uier/actions/runs/40157875500) |
| [#100](https://github.com/signalco-io/uier/pull/100) | #85/#88 edits and reproduction context | `203428b` → `8e351e9` | [CI OK and web/preview](https://github.com/signalco-io/uier/actions/runs/40159297479) |
| [#101](https://github.com/signalco-io/uier/pull/101) | #82/#87 installation and shared page identity | `ec6e65c` → `aadf5ff` | [CI OK and web/preview](https://github.com/signalco-io/uier/actions/runs/40162238049); [existing #90 evidence](https://github.com/signalco-io/uier/issues/90#issuecomment-6393522419) |

- [ ] Record #83's merged PR/head/checks and rerun two-reviewer freshness/read-state integration.
- [ ] Record #84's merged PR/head/checks and complete real email/opt-in/delivery acceptance.
- [ ] Record #86's merged PR/head/checks and combine durable drafts with uncertain-submit recovery.
- [ ] Rebase on the combined main revision; rerun local required checks, portable engine scenarios
  and the performance samples. Fix combined-flow defects without duplicating dependency work.
- [ ] Complete the separately hosted HTTPS two-person flow across real pages; record site, exact
  deployed revisions, browsers/devices, timestamps and privacy-safe evidence.
- [ ] Complete physical iOS/Android movement, keyboard/orientation/zoom, and screen-reader checks;
  resolve the Firefox runtime limitation or record and accept an explicit supported-browser limit.
- [ ] Record final local/hosted check and merge receipts, verify issue state, then update only the
  matching #90 and MVP-acceptance checkboxes in #77 when their criteria actually pass.

The touch-target defect found by the new flow is fixed by a coarse-pointer 44 px minimum inside
the toolbar shadow root. The original 32 px pin is centered within its larger target, and thread
headers wrap actions so the public number remains readable on narrow screens. This adds no data
collection, storage keys, recipients or third parties,
so it does not change privacy or cookie disclosures.

## Mark all as read, October 28, 2026 (#136)

The bulk-read implementation rebased onto `562927c` produces a toolbar of **689,133 raw /
202,157 gzip / 170,064 Brotli bytes**, including injected CSS and the existing license notices.
At this audit, the single-bundle limits were **750,000 raw / 220,000 gzip**; the current loader
limits are listed in the methodology above. `launch-performance.spec.ts` now also
checks that the 100-thread inbox is acknowledged by one 100-entry request and its badge clears.
The other activity/inbox tests exercise filtered lists, sequential 200+5 requests, a racing reply,
partial etag failures, retained retry cursors, guest/member access, private visibility, queued-digest
suppression and light/dark accessibility. The page picker keeps a 144 px minimum beside the new
action on narrow screens.

## Responsive feedback capture, November 3, 2026 (#319)

Capture used to copy the whole page (`document.documentElement`, every element's computed styles)
in the click that opened the composer, so the composer waited for it. A CPU profile of the long page
attributed 267 of about 400 ms to the library's copy, 215 ms of it reading every element's computed
styles. Capture now reads the window, scroll and scrolled elements at the click, copies after the
composer's first frame in pieces of about 8 ms, leaves out blocks more than a window's size from the
window, and encodes with `toBlob`. Omit screenshot stops a capture still being taken.

Local Chromium 156 production builds, three samples per profile, `?sections=250` scrolled to the
middle. Before is `main` at `1917219`.

| Profile | CPU | First frame (before → after) | Encoder completion | Longest task | Blocking time |
| --- | --- | --- | --- | --- | --- |
| Desktop Chromium | 1× | 324–328 → 15–16 ms | 360–366 → 125–127 ms | 318–323 → none ≥ 50 ms | 268–273 → 0 ms |
| Desktop Chromium | 4× | 1,322–1,392 → 30–34 ms | 1,473–1,542 → 417–441 ms | 1,299–1,368 → 60–73 ms | 1,322–1,391 → 10–23 ms |
| Pixel 5 / Chromium | 1× | 330–331 → 13–16 ms | 380–382 → 137–140 ms | 323–324 → none ≥ 50 ms | 273–274 → 0 ms |
| Pixel 5 / Chromium | 4× | 1,302–1,374 → 30–32 ms | 1,503–1,574 → 434–440 ms | 1,280–1,352 → 61–65 ms | 1,349–1,424 → 11–15 ms |

The remaining 60–73 ms task at 4× is React rendering the opened composer in the toolbar; the CPU
profile shows no capture work in it.
Captures of the long page (desktop and mobile; top, middle and bottom; `html-scroll` and `body-hidden`
layouts, borderless cards whose margins collapse through them, a grid) were pixel-identical to the
previous capture's.
