# The brand page (`/brand`)

It is the live reference for the brand and must keep rendering from `@uier/brand` and the UI
kit (no screenshots, no copied values). When you add a brand token, component style or asset,
add it to the page in the matching section. `e2e/brand.spec.ts` checks that the page renders,
that the assets (favicon, icons, manifest, OG image) are served, and that it passes axe.

The pull-request state specimen imports `PullRequestStateBadge` directly. Its display-only module
keeps the live thread controls, provider state reads and mutation Action out of the brand page.

## Components (`/brand/components`)

The component catalog: every component people see, in each state it ships in, for designers and
developers to review with the toolbar. Like the brand page it renders the real components (no
copies, no screenshots), so it changes when they do.

- `src/components/brand/catalog/catalog.ts` lists the groups and entries (id, name, source path,
  an optional note). The page's index and each specimen's header read from it; a specimen whose id
  is missing there throws, so the two cannot drift.
- `Specimen` and `State` (`Specimen.tsx`) draw an entry and its states. The entry's element id is
  its catalog id, and each state has a `data-anchor` of `<entry id>/<state label>`, unique on the
  page, which the toolbar's anchor selector prefers over positions. A comment therefore stays on
  its state when states are added or reordered. Do not rename an entry id or a state label that has
  comments; add a new state instead.
- Group files: `SiteSpecimens.tsx` (brand marks, `@uier/ui-primitives`, `ContentPage` blocks),
  `AppKitSpecimens.tsx` (`src/components/ui`), `AppPatternSpecimens.tsx` (`src/components/app`).
  When you add a component to the UI kit or a shared app component, add its entry and its states.
  Specimens take only example content (the imaginary restaurant site), never app data, actions or
  providers beyond the marketing layout's. The page is prerendered, so a specimen renders the same on
  every load: no random or time-based values (`SidebarMenuSkeleton`'s random width fails the build).
- The page's axe scan skips the kit's destructive Button, Badge and Alert specimens, which are below
  4.5:1 as they ship (`knownContrastIssues` in `e2e/brand.spec.ts`). Remove each exclusion with its fix.
- Anchored overlays (tooltip, popover, dropdown menu, select) have an Open state with a Keep open
  switch: while it is on, the overlay ignores outside clicks (the toolbar's) and stays open, so it
  can be commented on. Menus and selects are non-modal there. Dialogs, alert dialogs and sheets
  cover the page and open from their buttons only.

`e2e/brand.spec.ts` checks that every catalog entry is in the index and on the page, that the
state anchors are unique, that Keep open survives an outside click, and that the page passes axe.
