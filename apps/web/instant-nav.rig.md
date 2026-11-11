# instant-nav rig: uier

- BUILD: Node 26, Corepack pnpm (root packageManager). From the root,
  `UIER_INSTANT_TEST=1 pnpm build`; then Playwright starts that artifact with
  `pnpm exec next start -p $PORT`. The existing webServer lifecycle owns the
  app and service stubs, refuses occupied ports, and stops them after each run.
  `PORT=4314 pnpm test:instant` runs the complete build-and-test sequence.
- EXPOSE: `UIER_INSTANT_TEST=1` at build time, with VERCEL, VERCEL_ENV and
  UIER_DEPLOYMENT_ENV absent. The option is false for ordinary builds and for
  deployment builds even if the opt-in is accidentally inherited. Turbo hashes
  and forwards these inputs. Never deploy a testing artifact.
- RUN: `PORT=4314 pnpm -C apps/web exec playwright test --config=playwright.instant.config.ts`.
  This is the complete scope: every contract and data variant on Desktop Chrome,
  Mobile Chrome and Tablet Chrome; zero retries. Base URL is http://127.0.0.1:4314.
  Regular Playwright excludes this dedicated-build suite. CI runs it in its browser job.
  CI runs browser/security essentials on an ordinary build first, then rebuilds with
  UIER_INSTANT_TEST=1 immediately before this suite. Do not use the testing artifact
  for normal CSP acceptance: Next injects a test-only inline bootstrap.
- TEST USER: fresh local email-code account via support/app.ts, welcome skipped;
  own Personal workspace, admin role, English by default. Empty and populated
  workspaces use real pages/actions; populated creation includes an existing client.
  No production data, email, Cosmos, provider requests or credentials.
- DRIFT: saved app language precedes Accept-Language; a fresh account has no projects;
  feedback workspace forbids project creation; commenters cannot create projects;
  welcomePending and sign-in can redirect. Tests reach the actual source and
  completed destination before trusting locked failures. Local service status is operational.
- CONTRACTS:
  - `/app/projects` → real Create project Link → `/app/projects/new`: heading,
    explanation and four onboarding steps immediately; existing PageLoading for
    the form; private client suggestions and form stream afterward. Empty/populated variants.
  - `/app/projects` → sidebar Account menu's Next Link → `/app/account`: Account
    heading and five section links immediately; email and profile/access forms
    remain request-scoped, with existing PageLoading. Empty/populated variants.
  - Hard `/status`: existing Status heading, How this works explanation, summary
    and service-check fallbacks immediately; independent live summary and checks
    absent while locked and present after release. Already satisfied, no route change.
- CONSTRAINTS: hard signed-in loads retain the request-language and account shell
  boundaries. No private data, permission-dependent links or catalogs enter a shared
  cache. Proxy pageAccess and page/action/API checks preserve document redirects,
  404s and authorization. No data-source, freshness, sorting or Partial Prefetching change.
- LOOP: build → run (fresh production server) → inspect screenshots/results → edit.
  Establish unlocked reachability, then failing instant() assertions before optimizing.
  Revert only route/component optimization → build → same tests fail; reapply →
  build → complete RUN passes. Capture locked/completed screenshots as test attachments.
  Delete unlocked scaffolding before committing. No additional permission needed locally.
- LIVENESS: n/a; freshly completed local build/start, occupied ports fail rather than reuse.
- WALLS: dependencies must be installed before reading Next's version-matched bundled
  docs. next and @next/playwright are exactly 16.4.5; Playwright is exactly 1.65.0.
  Testing API exposure is a build input; setting it only at server startup does nothing.
  The dedicated config also sets UIER_INSTANT_TEST=1 on next start: this release reloads
  next.config.ts there, and hard-load locking needs the opt-in at both stages.
  Status hard loads use domcontentloaded while dynamic response streaming is held.
  Dev verification uses separate ports; next dev never supplies instant() evidence.
