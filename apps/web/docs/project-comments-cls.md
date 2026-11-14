# Project comments CLS investigation

[uier #298](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_EILYT0BWoj2U_dE6K5wIw)
reported CLS 0.75 in Edge 157 at 1674 × 1366. The local investigation used Chromium
158.0.8127.18 against `pnpm build` / `next start`, with the real local sign-in and project actions,
20 real API-created threads, 4× CPU slowdown, and the reported desktop viewport plus Mobile Chrome
(393 × 727). No production data or settings were changed.
The baseline source was `3adaec4d938ae2f5eb7c68d262fb193339ab688a`; the same regression ran with
the implementation changes temporarily removed, then restored, in the same worktree and runtime.

The observer starts before the document, records every source rectangle, and calculates the largest
session window: gaps under one second, windows under five seconds, excluding recent input and
toolbar-only sources, like `packages/toolbar/src/checks/webVitals.ts`. Scripts are held until the
server-rendered comments have painted, then released; read-all, a background unread arrival, an empty
search and the app's real Give feedback injection follow. Each run attaches `project-cls.json`.

| Same scenario | Before | After |
| --- | ---: | ---: |
| Desktop CLS | 0.016096 | 0 |
| Mobile CLS | 0.034252 | 0 |
| Desktop board top, unread → read → new unread | 303 → 263 → 303 px | 303 → 303 → 303 px |
| Mobile board top, unread → read → new unread | 400 → 348 → 400 px | 400 → 400 → 400 px |
| Desktop search left, populated → empty | 289 → 481 px | 289 → 289 px |
| View painted before hydration | List | Board |

The original 0.75 was **not** reproduced with this local dataset. These numbers establish the
identified causes and their fixes, not production acceptance in the reporting browser. The
regression fails against the original implementation on both view/geometry assertions even though
its smaller dataset's CLS already falls below 0.1. Both profiles pass after the change, with no
layout-shift entries in this scenario.

## Sources and causes

| Observed shift | Cause | Resolution |
| --- | --- | --- |
| During hydration the count row moves up 40 px on desktop (303 → 263; score 0.000903); 58 px on mobile (406 → 348; score 0.009018, recent input in that run). The server has painted List. | `ProjectComments` reads localStorage in a layout effect and rewrites the URL after the server's list has painted. Board removes the list's status tabs. | Fixed. A request-readable view cookie supplies the server's initial view. Without the cookie the server paints the list, so a browser with no choice never waits on a loading state; one with only the older localStorage preference switches once after hydration, then migrates to the cookie. Explicit URL views win without changing the saved preference. |
| Reading all unread moves the board up 40 px on desktop (score 0.016096) and 52 px on mobile (0.034252), both recent-input entries. An unread arrival moves it back down with the same scores **without** recent input. | The count/action row becomes `sr-only`, removing its height and the flex gap; a new unread thread puts it back. | Fixed. A populated project inbox reserves the row's 32 px height (44 px on touch) and keeps the existing gap. Empty projects still hide the row. |
| In an isolated intermediate run, marking read moves titles and paths 16 px left (desktop score 0.000698; mobile 0.004275, both recent input). | The unread dot and the spacer beneath it are removed from the avatar column. | Fixed. The dot becomes invisible while retaining its width; the selection spacer remains. Later ([uier #330](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_b2Gm-d2cgbuNluXDNRC1q)) the dot moved into the row's left padding, out of the flow, so the reserved gutter and the spacer went. |
| Empty search moves the project header and filter row 192 px right on desktop and shrinks them from 1344 to 960 px (score 0.011817, without recent input). | Header width depends on matching results. Removing the board also removes the shell's width-container marker. Fixing only the header condition leaves a further 24 px shift (score 0.001809 in an intermediate run). | Fixed both causes. Width follows the chosen view throughout a populated inbox; its outer container keeps `data-page-width="wide"` when results empty. |
| Give feedback mounts its toolbar and dialog; search geometry stays unchanged on both profiles. | Toolbar content is in its shadow root with positioned overlays. | No page shift observed; no toolbar changes. The observer retains toolbar-only entries separately and excludes them from CLS. |
| Streamed shells, project header and loading placeholders. | Request-scoped boundaries replace their fallbacks. | No separate shift source observed in these runs. Retained the existing boundaries and skeletons; the local store does not reproduce slow production database streams. |

## Regression coverage

`e2e/project-cls.spec.ts` checks the budget, pre-hydration view and exact board/search geometry on
desktop and mobile. `comment-board.spec.ts` additionally checks legacy preference migration while
scripts are held, URL precedence, reload, cookie fallback with blocked localStorage and URL-only
operation without either saved preference. Board, optimistic/read interactions and tablet coverage
exercise the surrounding layout.

Reproduce on a free port with an up-to-date build:

```sh
PORT=4304 pnpm build
PORT=4304 PLAYWRIGHT_FULL=1 pnpm -C apps/web exec playwright test project-cls.spec.ts --project="Desktop Chrome" --project="Mobile Chrome" --retries=0
```

Recheck the original project in Edge after deployment. If it still reports a higher score, collect
that document's buffered layout-shift sources and the preceding navigation/actions; the page's
whole lifetime, including previous client navigations, contributes to its largest session window.


Project pagination retains the populated width marker and reserved count row even when the first
page has no rows (for example, all matches are in collapsed Archive). Server-side view preference
resolution happens before selecting initial pages, so hydration does not replace the server's view.
Virtual row spacers keep the column's height, which the page scrolls; subsequent pages extend the
column (uier #400). Below 1024 px the inbox spacers preserve its document scroll extent instead, so the list
does not become a small nested viewport. The existing CLS regression remains the geometry guard;
the larger fixture records DOM
and payload measurements separately ([paging](comments-inbox.md#measurement-and-remaining-database-work)).


The paged regression at 4× CPU slowdown measured CLS 0 on desktop and 0.027126 on mobile,
both below 0.1. The mobile entry was the expected shift of existing cards when a live arrival was
inserted above them inside Open; the board top, filter row and search geometry stayed unchanged.
These measurements are local Chromium evidence, not acceptance of the original Edge report.

For uier #410, background socket/action reads use only the paged data endpoint, preserving the page
tree. Every board header reserves its progress slot while idle. `realtime.spec.ts` holds a read and
asserts identical action geometry, node identity and focus, plus reduced-motion and failure/retry
behavior on desktop/mobile. This adds no new production CLS measurement.
