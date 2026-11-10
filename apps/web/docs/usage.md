# Usage

What the rate limits ([API limits](../../../docs/api.md#comments-api)) allow and how much of each is used now.
Two pages show it, and the toolbar links to them when a signed-in member reaches a limit.

- **Account → Usage** (`account/usage/`, `KnownPageLinks.accountUsage`): the person's own hourly limits in every
  project they can see, in all their workspaces (the open one first, a workspace heading only when there is
  more than one), so a toolbar link finds its project whichever workspace is open. Each project's item has the id
  `projectUsageAnchor(<public id>)`: new comments, replies (MCP replies count against the owner's), rewrite
  suggestions (with the SEO panel's page suggestions, which share their counters; the meter's description says so), and on uier's feedback project the per-address writes ("From your network"). A last card shows
  the per-address rewrite suggestions on every site. Address rows come from this page request's IP bucket
  (`rateLimitIpBucket`) and are missing locally on loopback; the page never shows an address.
- **Workspace → Usage** (`workspace/(tabs)/usage/`, a tab for everyone, `KnownPageLinks.workspaceUsage`): what each
  project the person can see in the open workspace shares per day: screenshots and rewrite suggestions, plus the
  per-page comment limit as text (counted per path, which the page can't list). `?project=<public id>` names
  the project a toolbar link came from; when it is in another of the person's workspaces, an alert offers
  **Open workspace** (`openProjectWorkspaceUsageAction`, which finds the workspace from the person's memberships
  and current access, never from the request).
- **Meters** (`components/app/usage/UsageMeter.tsx`): shadcn `Progress` with "3 of 100", amber from 80 % and red
  with "Limit reached" at the limit; `aria-valuetext` says the same. Descriptions sit under the bar so the bars of
  a row line up. `resetsIn` words when counts start again: hourly limits on the hour, daily ones at midnight UTC.

## Rules

- Every limit is defined once in `lib/comments/rateLimits.ts` (`authorCommentsLimit`, `siteScreenshotsLimit`, ...):
  enforcement counts with `consume`, the pages read the same counter with `usedOf` (`CommentsStore.getCounter`,
  a point read that never counts). Add a new limit there with its `usage` page, then show it here.
- uier's own feedback project takes the toolbar's writes through the anonymous comments API, which keeps the
  visitor and IP limits for every writer, staff included; the account page shows those counters for it.
  Elsewhere members see the member limits. (Staff writes through the review API, such as MCP replies, count member
  counters that the page does not show.)
- A `429 rate_limited` names its page in `usage` (an app path) only for a signed-in member (`usageLinks`):
  personal limits link the account's page at the project, project-wide ones (page, screenshots, a site's
  suggestions) the workspace's. Guests have no account, and the app-wide suggestion budget has no page.
- The toolbar accepts `usage` only as an `/app/` path on its API's origin (`usagePageUrl` in `hooks/api.ts`) and
  opens it in a new tab: **View usage** on the not-sent toast (which then lasts 15 seconds and waits while
  hovered or focused) and after inline messages (`UsageLink`).

## Tests

`review-rate-limits.api.spec.ts` checks the `usage` paths of member, page and suggestion rejections, none for
guests, and `usedOf` counts; `public-project.api.spec.ts` the account link for enrolled commenters.
`usage.spec.ts` (full suite, desktop and mobile) uses up a commenter's hour on uier's feedback project, follows
**View usage** from the toast to the account's page, then opens the project's workspace from the workspace's
page, with axe checks in light and dark.
`app.spec.ts` and `users.spec.ts` include Usage in the account, admin workspace and commenter
workspace navigation expectations, retaining the checks that restrict management tabs to admins.
