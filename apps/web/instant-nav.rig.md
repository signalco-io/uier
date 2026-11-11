# instant-nav rig: uier

- BUILD: Node 26 and Corepack pnpm, `UIER_INSTANT_TEST=1 pnpm build` from the root.
  Playwright's existing webServer starts that artifact with `next start -p $PORT`, owns
  all local stubs, refuses occupied ports and stops the servers after each run.
- EXPOSE: `UIER_INSTANT_TEST=1` at build time, with VERCEL, VERCEL_ENV and UIER_DEPLOYMENT_ENV
  absent. Ordinary/deployment builds exclude the testing API. Turbo hashes and forwards these inputs.
- RUN: `PORT=4404 pnpm -C apps/web exec playwright test --config=playwright.instant.config.ts`.
  All contracts on Desktop, Mobile and Tablet Chrome, zero retries. Base URL http://127.0.0.1:4404.
  Regular Playwright excludes this dedicated suite. CI's disposable browser-test build includes it.
  The dedicated config checks the artifact's testing API flag and also opts in at server startup.
- TEST USER: public/no auth for Status. Fresh email-code local accounts via support/app.ts for
  My work; welcome skipped, own Personal workspace, admin, English, empty/populated real projects.
  Existing test configuration isolates Cosmos, email, screenshots and providers from production.
- DRIFT: saved app language and selected workspace affect UI. Fresh accounts use English/default
  browser locale and own workspace. Tests use unique accounts, real actions and actual source Links.
- CONTRACTS: Security footer → `/status`: heading, explanation and both independent live-check
  fallbacks immediately, timestamp and operational state after release. Projects sidebar →
  `/app/my-work`: existing app navigation and page loading status immediately; authorized heading
  and empty work result after release, in empty/populated workspaces. Exact final URL, no query.
  Audit: no effective full-prefetch Links and no manual prefetch calls; these are additional shell checks.
- LOOP: build → Playwright-owned start/test/stop → inspect results → edit. Stop dev on 4304/4305
  before rebuilding; never delete a running server's generated files. Reuse this rig for optimization.
  All local work is authorized; hosted checks and deployments are tracked separately.
- LIVENESS: n/a; freshly completed local build/start, with occupied ports failing instead of reuse.
- WALLS: next and @next/playwright are exactly 16.4.5; @playwright/test is exactly 1.65.0.
  Use one object spread (`defineConfig({ ...base, ... })`) so named-project merging cannot retain
  the API project in this dedicated suite. Negative locked assertions prove the testing API is live.
  Dev verification uses Next MCP and isolated browser sessions; dev does not establish prefetch readiness.
