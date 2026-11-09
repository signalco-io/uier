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
