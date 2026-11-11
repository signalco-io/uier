# Environments

- **Environments** is one table, `ProjectSitesForm`: each address with its label and the addresses it shares feedback
  with (a group of origins, stored as the environment's `group`; the UI never names groups). `siteRows.ts` holds the pure
  rules (`e2e/site-rows.api.spec.ts`): addresses show without their default scheme (`typedAddress`), addresses on one
  origin follow the first one's label and sharing, sharing goes both ways, groups of one site are dropped, and a group
  keeps the name it was saved with (environment filters link to it) or is named after its first row's label or host.
  The table is a card per address below the `@xl` container width.

- `src/lib/app/environments.ts` owns origin labels, explicit shared groups (Settings → Environments, "Shares feedback with") and historical-source
  fallback. Apply `environmentFilter` before storage limits and before activity/unread selection;
  Cosmos and memory stores share `repo/originFilter.ts`. Do not infer missing origins or retarget
  removed sources. App direct-comment redirects load the authorized stored thread and retain its
  permitted original source plus canonical saved page state. Environment filters never grant access.

- **Switching environments in the toolbar** (Options → Environment, `ToolbarOptions.tsx`): with more than one http(s)
  address in `GET /api/review/<code>`'s `environments` (sent only to those who can comment), Options names the one being
  reviewed and lists them all, the current one checked (`aria-current`). Each other one is a link to this page there
  (`environmentLink` in `packages/toolbar/src/review.ts`): only the origin changes; the path, query and hash are copied as
  they are (the path set on its own, so `//host` can't lead away), and a review appends its review link (`toolbar-code` or
  `review=true`, as a comment link does) so the toolbar opens there too. It opens in the same tab: the UI kit's links open
  another origin in a new one unless given `target="_self"`. The packaged extension ends its activation on a cross-origin
  navigation, so there the reviewer starts the review again. `e2e/environments.spec.ts` covers it.
