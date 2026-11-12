# Landing page

Copy and structure follow `BRAND.md`, "Marketing and metadata": the tagline is the `h1`, the
review layer is shown with persisted starter threads (the toolbar renders their pins and highlights), one solid
"Get started" and one outlined secondary action ("See features", to `#features`), no badges above the headline.
The secondary action and the header's links go to sections lower on the page: a link to `#how-it-works` from
the top of the page moves nothing on wide screens, where the scene is already in view, and reads as a bug. The cover beside the
headline is the how-it-works scene (`HowItWorks`), and the description stays a direct child of the
hero's first column (tests select it as `main>section>div>p`). "Try it on this page" points visitors
to the real toolbar; it does not embed a thread.

Sections, in order, each with an `h2` whose id has a `KnownPages` route:
how it works (`#how-it-works`, the small heading over the cover scene), features (`#features`), get
started (`#get-started`), pricing (`#pricing`, `LandingPricing`) and questions (`#faq`,
`LandingFaq`, native `<details>`). The header navigation links features, compare and FAQ, not
how it works or pricing; the footer links both. The site header is fixed and 64px tall: the marketing layout sets
`scroll-padding-top` on the document (80px), so every in-page link on the marketing pages, followed from
the header or footer, or opened directly (`/#pricing`), lands with its heading below the header. Don't add
`scroll-margin-top` to anchored sections or headings; it adds to the padding. Next.js scrolls to the hash
itself, so the global `:target` margin does not apply there and the layout turns it off.

- **Only what uier does today.** Every step, feature and answer describes behaviour that ships: in
  the toolbar (check `packages/toolbar`) or in the app's projects (check `src/lib`) before adding
  one. Say which parts can be tried on the page itself: the showcase is a guest, so pins, threads,
  the inbox and the Accessibility and SEO panels work here, while mentions, assignment, the board,
  environments, integrations and the MCP connector only work in a project. The feature tiles link to
  the feature pages (`/features/page-checks`, `/features/fix-verification`, `/features/ai`) and `/integrations`. The showcase runs on
  every public marketing page and its inbox includes other public pages. Project embeds work on
  their configured addresses, with headers for identity and BotID proofs for writes.
- **Pictures are specimens.** The cover scene and the feature tiles are built from the tokens and
  `<Pin />` (`HowItWorks`, `LandingSpecimens`), hidden from assistive technologies, never
  screenshots; keep their text out of the strings the e2e tests look up on the page (the FAQ's
  "add one script tag to your site", the description). The starter thread "Try it here" is pinned
  to the "Try it on this page" box by `id="first-step-comment-anchor"`; the id is stored in
  production, so keep it.
- **Pictures copy the shipped controls.** Each specimen draws the control it shows as it ships: the toolbar pill
  (`ToolbarIllustration`, in `CommentToolbar`'s order), the thread header with its status menu and each status's
  colour (`CommentThreadHeader`), the inbox's search, page picker, filters and Active/Done/All tabs (`sidebar/`),
  the checks panels (`components/checks/`), and the app's board, rows and filter bar (`CommentBoard`, `CommentRow`,
  `CommentFilters`). Recheck the pictures when one of those changes; the component comments name what each copies.
- **Feature tiles alternate wide and narrow** (wide, narrow, narrow, wide, ...): at `lg` each row is one wide and
  one narrow tile, at `md` the narrow ones pair up and the wide ones take a row, so neither width leaves a gap.
  Add or remove tiles in pairs that keep the pattern.
- **"And the details"** follows the tiles: an `h3` over a `Panel` of six cells (icon, title, one sentence), three
  columns at `lg` and two at `md`. Keep it to six, the strongest things the tiles do not show; swap one out
  rather than add a seventh.
- **Compare workflows** links from below the feature panel to `/compare`. Keep it a contextual
  link for people choosing a tool; the comparison hub carries the feature matrices and tradeoffs.
- **One section moves.** The how-it-works scene is a timeline of phases (`phases` in
  `HowItWorks.tsx`); everything in it is always rendered and shown or hidden with the brand's fade,
  and the pointer's targets are measured from the scene, so it follows any width. It plays only
  while in view, Pause stops it, and with reduced motion it shows one still frame. Its canvas is
  `data-uier-decorative` with a `min-height`: the toolbar's screenshots keep its box but not its
  content (copying it made every capture on the landing page much slower). The e2e axe scan skips
  the scene (`data-landing-scene`): it is a picture, and a frame caught mid-fade has low contrast. Keep the other sections still, and keep each section's layout
  different from its neighbours.
- **Get started** (the hero and pricing) opens `/app`, like the navigation's "Sign in": signed-out
  visitors land on sign in, signed-in people in the app. The `#get-started` section below the
  features still offers both paths: trying the showcase toolbar on this page, or a project for
  your own site. That card shows the install guides and the browser extension's browsers as chips
  (see [browser-extension.md](browser-extension.md)).
- **Pricing** is `brand.pricing`, word for word, and one free offering: no prices, tiers, trials
  or limits. The app has no billing page while everything is free.
- **Context and privacy:** the context tile describes a screenshot attempt, not guaranteed capture.
  The saved-data FAQ names sensitive visible content, omission before posting, later redaction and
  its inability to recall delivered copies, member-only browser/OS details and requested rewrite
  inputs sent to Anthropic. Guest feedback is public; signed-in uier feedback is author/team-private.
  Both uier feedback projects have the 90-day TTL; customer projects retain feedback until deleted.
  Keep the own-website question, persisted demo ids, tagline and pricing unchanged when updating copy.
  The homepage description owns broad website-feedback, client-review and bug-report intent.

`e2e/landing.spec.ts` asserts the title, the `h1`, the "Get started" links, the sections, the
pricing copy, the FAQ keyboard behaviour and the footer line through the brand constants; update
the test when you change those on purpose.
