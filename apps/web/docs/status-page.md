# Status page

`/status` (static header/explanation, streamed live results) and `/api/status` render `getServiceStatus()` from `src/lib/status`: only what
those checks measure, at request time. Do not add uptime percentages, history or services that are
not checked. A new service gets a real check there first. `e2e/status.spec.ts` covers both.
The live readers wait for a request before using the existing 30-second snapshot; no build-time
health result is cached in the shell. See [Cache Components](cache-components.md).
