# Status page

`/status` (static header/explanation/service rows, streamed live results) and `/api/status` render `getServiceStatus()` from `src/lib/status`: only what
those checks measure, at request time. Do not add uptime percentages, history or services that are
not checked. A new service gets a real check there first. `e2e/status.spec.ts` covers both.
The live readers wait for a request before using the existing 30-second snapshot; no build-time
health result is cached in the shell. See [Cache Components](cache-components.md).

## Loading

Which services are checked is fixed: `serviceDefinitions` in `src/lib/status` holds each one's id, name
and description, and `runChecks` gives each its state (its `Record<ServiceId, ServiceState>` does not
compile for a definition without a check). The page's static shell draws those rows for real, each with
a muted dot and "Checking…" where its result goes, and the results replace only that state.

- The shell (`ServiceChecksLoading`) reads the definitions only. It must not run or await a check, call
  `connection()` or read the request: that would take the rows out of the static shell. Every service
  says "Checking…" there, Website included; a result in the shell would be a build-time one.
- Nothing moves when the results arrive. The shell and the loaded panel render the same `ServiceRow`
  and the same line under the panel (`checkedLine`: empty while checking, then "Checked" and the time).
  From `sm` a row's state keeps the width of the longest label ("Not responding"), so no result changes
  where a description wraps; a longer label needs that width raised. A line that only some results
  show (a failing service's detail) would need its place kept in every row first.
- The panel has one `role="status"` while it loads, "Loading service checks…", read out and not drawn:
  it stands where the "Checked" line goes. The header's summary keeps its own "Checking services…".
- `e2e/instant-nav.spec.ts` and `e2e/partial-prefetching.spec.ts` hold the page at its shell: the rows
  are there, none is operational, there is no time yet, and the Services section is as tall as it is
  once loaded.
