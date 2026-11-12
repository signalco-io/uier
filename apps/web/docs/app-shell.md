# App shell, navigation and the projects list

The shell and each request-dependent segment use the boundaries described in
[Cache Components](cache-components.md). The initial shell contains no private data. Proxy completes
document access decisions before it streams; pages and actions retain their own checks.

`ClientProvider` owns theme and document-policy handling. Its next-themes initializer stays inert;
the root layout owns the fixed hash-authorized theme script. The Next app has no React Query provider;
the separately bundled review toolbar owns its own query cache.

- **Notification landmark.** App pages mount only the shadcn Sonner toaster. The public layout
  mounts `PublicNotifications` inside the theme provider; `ClientProvider` does not import that
  notification implementation into app routes. Both containers otherwise expose the same "Notifications alt+T" region, even when empty.
  `e2e/app.spec.ts` checks one notification region and axe `landmark-unique` on the project, projects
  list and account pages. This rule is outside the WCAG tags used by the general accessibility scan.
- **Layout.** `(shell)/layout.tsx` is the sidebar (`AppSidebar`: workspace switcher (its menu lists the
  person's workspaces to switch between, the current one checked, also when it is the only one (uier #257), creates one (`createWorkspaceAction`, a dialog for the name) and, for admins, opens Workspace
  settings), Projects (the projects index; the person's own work goes beside it), active projects (every project when grouped by status) with a
  Create project icon link and a Sort and Group menu (`ProjectOrderMenu`) in their header, then at the bottom Workspace (admins; for everyone else only when a
  visible project has a client), Give feedback and the account menu: rows like the navigation's, 4px apart like them (uier #165: the Workspace group has no bottom padding and the footer `gap-1 pt-1`), the person's avatar centred in their 16px icon column so
  its name starts with the labels above; the email is in the account menu, with Keyboard shortcuts). The navigation's
  links are one tab stop (the current page's): ↓ and ↑, Home and End move between them; `LinkTabs` move with ← and →
  ([keyboard](keyboard.md)). The layout also holds `AppShortcuts`, the inset panel with the breadcrumbs
  (`AppBreadcrumbs`, from the path: one line, a long name cut short; a project's crumb starts with its `ProjectMark`,
  the site's favicon, uier #279) and the one invite dialog (`InviteProvider`; `InviteButton` and
  `useInvite()` open it). The sidebar is docked from `lg` (1024 px: landscape tablets and wider), where the panel keeps
  its frame and scrolls inside it; narrower (phones, tablets in portrait) it is a sheet behind the top bar's toggle
  (`useIsMobile`, `hooks/use-mobile.ts`, in step with the `lg:` classes of `ui/sidebar.tsx` and the shell layout) and the
  page scrolls under the sticky top bar, so what sticks there (settings sections, the thread beside the list) sits
  below the bar. The sidebar's small actions (Sort and Group, Create project) keep their larger hit area on touch
  screens (`pointer-fine:after:hidden`) and take the Active projects label's colour (`text-sidebar-foreground/70`). `PageHeader` keeps its actions on the title's row and wraps the title
  beside them; only below 20rem for the title (a phone) do they go under it. `e2e/tablet.spec.ts` (the Tablet Chrome
  project) covers portrait and landscape tablets. Pages sit in a centred reading column (`max-w-5xl`) on every page, in every view, 24px below the top bar at every width:
  the same space as under `PageHeader` (`pb-6`, the gap to the comments' search; uier #181). An element that lays things
  side by side breaks out of it with the `page-wide` utility (`app/global.css`: the panel's width less the gutters, centred
  on the column; its parent must span the column) and `data-page-width="wide"`, which makes the panel's content a container
  (CSS `:has()`, so it follows a client-side view switch at once) for the registered `--page-wide` length the column sets.
  The container is a wrapper inside the scrolling panel, not the panel: a scroller's `cqw` takes in its own scrollbar where
  scrollbars take room (shown always, as on macOS with a mouse), and the board would then be that much wider than the panel
  and scroll it sideways when its columns fit.
  The rest of the page stays in the reading column. Only the comments board and the
  comments list with its thread beside it ([comments inbox](comments-inbox.md)) do it, and the comments'
  filters header above them, the count line under that header and the project header take their width. [Page checks](page-checks.md)
  takes that width too (uier #214), and so does the project header above it. On a project's Comments and Page checks
  the content and both headers are the full `page-wide` width from the left, with no cap and no centring ([uier #363](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_bqLvicXdinxKaoz_A8cT0)). uier's own workspace, which every account joins for Give feedback, is a
  `feedback` option in the switcher for people who are not its admins, and the menu leaves it out (uier #257): their
  sent feedback is in Give feedback's toolbar. Only while a saved selection still has them in it is it listed, checked,
  as "Feedback on uier" beside their own workspaces to switch back to. Every account is in another workspace too
  (`getAppContext` creates its own when it has none), so there is always one to switch to. A project's header is
  `projects/[projectId]/layout.tsx` (the favicon in `PageHeader`'s `media`, beside both the name and the row under it: client (a link to the projects list filtered to it, `KnownPageLinks.clientProjects`, on the Done tab for a done project; uier #241), then who can comment (`ProjectAccessInfo`: its popover has the guest links and Invite for admins; for those who configure the project the label is a link to Who can comment in Review settings, `KnownPageLinks.projectAccessSettings`, and the popover opens on hover only, so Who can comment there shows the guest links too), Open
  review, then the `ProjectTabs` with the settings cog at their right end (`ProjectSettingsButton`, an icon link
  styled like a tab, with a tooltip, underlined and current on the settings pages; uier #282; it adds its Settings
  label where the tabs' row (`@container/project-tabs`) is at least 28rem wide, uier #331): Comments, [Page checks](page-checks.md) and Install (Settings → Installation and the onboarding
  install step) until a comment from one of the project's addresses arrives (`hasProjectFeedback`); after that Install is
  gone; the tabs' line runs to the inset panel's edges, a divider between the header and the page (uier #237): a 1px
  line whose shadow `clip-path` keeps to its row, so it adds no sideways scrolling); the Comments label lines up with the
  page content and the tabs show no loading spinner (uier #272); its pages render the comments,
  page checks, install guide or settings under it.
- **Project loading** ([uier #344](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_iO2SPR02hm0K7M1qE9GlP)): the Comments and Page checks tabs load in skeletons shaped like the page and
  as wide as it will be, so neither the project header nor the content changes width when the page arrives. Each
  skeleton carries the loaded page's `data-page-width="wide"` and `data-header-wide`, which widen the shell's column
  and the project header. `CommentsLoading` (comments/) draws the search row (search, the list's status tabs, Filter,
  List/Board), the count line's own row where it has one, then the list with the first thread beside it, or the board's
  four default columns and Archive's strip, from the left. The search row needs no data, so it is drawn for real but
  `inert` and `aria-hidden` (search, the status tabs with the address's tab pressed and their counts loading, Filter,
  List/Board with the opening view pressed; [uier #362](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_Wg-1DSXTyPI9bQLuSCxHj)). It picks the view the comments will open in from the address
  (`?view=board`), else the remembered one, and the list for Archive (`?status=archived`) as `ProjectComments` does.
  `ProjectCommentsLoading` (a server component, the page's and `ProjectLoading`'s fallback) holds two answers: the
  prefetched shell's guess from this browser (`CommentsLoading`: the address, read again as the skeleton commits so a
  navigation does not draw the page being left, and the remembered view; the server draws the list), then, under its
  own request-scoped boundary, the request's answer (`AddressCommentsLoading`: the router's `useSearchParams` and the
  view cookie), which streams before any comment is read.
  `PageChecksLoading` (pageChecks/) draws Across pages' two cards, Pages with its filter and order, and the table (the
  cards under 48rem). While the project layout itself loads, `ProjectLoading` (projects/) draws the header and tabs over
  the comments' skeleton. A project with no comments yet loads wide and then shows its narrower empty state; the
  skeleton cannot know. `e2e/instant-nav.spec.ts` holds each tab switch in its loading state (`instant()`) and checks
  that the header and the project's name do not move when the page arrives (`pnpm test:instant`).
- **Sidebar project order.** `ProjectOrderMenu` has two labelled radio groups: Sort (Recent activity, Recently
  created, Name) and Group (None, Client once an active project has one, Status). Only Group → Status lists the done
  projects too, under Active and Done, and the header then reads "All projects" (`listsProject`).
  `lib/app/sidebarProjects.ts` gives every project its status, creation time, client and, only for Recent activity
  and only for the listed projects, its latest activity: `CommentsStore.latestActivity`, one `MAX(c.updatedAt)`
  aggregate per project with `canSeeComment`'s rule in the query (`commentVisibilityFilter`,
  `repo/visibilityFilter.ts`), else the project's creation. The other sorts read no comments; choosing a new order
  saves the cookie in a server action, whose render reads them. `lib/app/projectOrder.ts` (pure, shared by server
  render and browser) sorts with a fixed `en` collator and code-unit comparisons for ids and timestamps, so both
  agree, and groups by client (clients ordered like their projects, No client last) or by status (Active, then Done).
  The choice is the HttpOnly `__Host-uier_project_order` cookie (`projectOrderCookie.ts`, `saveProjectOrderAction`):
  the sort, then `.client` or `.status` (`recent`, `alphabetical.client`, `created.status`). Values saved before
  Sort and Group (`recent`, `alphabetical`, `recent.client`, `alphabetical.client`) are the same strings and read
  back as the same choice; anything else is the default. The shell layout reads it, so the first render is already
  in order. The shell layout
  renders on every refresh (`RealtimeComments` too): keep its reads point reads or bounded aggregates, and list them in
  [Cosmos query costs](../../../docs/cosmos-query-costs.md#shell-layout-sidebar-project-order).
- **Workspace area** (`workspace/`): the workspace's name above `LinkTabs` (`workspace/(tabs)/layout.tsx`,
  `workspaceTabs`): Users, Teams, Clients, Usage, Activity and Settings for admins, Clients and Usage for everyone
  else and in the uier workspace ([Usage](usage.md)). `/app/workspace` opens the first tab. A team's and a person's own pages (`workspace/teams/[teamId]`,
  `workspace/users/[userId]`) are outside the `(tabs)` group, with their own header. The old addresses
  (`/app/users`, `/app/teams`, `/app/clients`, `/app/settings` and the team and person pages) redirect there
  (`next.config.ts`). Each page keeps its own authorization: Users, Teams, Activity and Settings are admin-only.
  Settings has General (the name) and Email domains ([access and membership](access-and-membership.md#email-domains)).
  Activity renders access events as sentences (`teams/activityText.ts`, pure, with names from
  `teams/activityNames.ts`, which also looks up people who left, archived teams and who accepted an
  invitation); never show raw actions, ids or before/after JSON. Users shows its filters only past
  `FILTER_FROM` people and invitations, and only those that tell people apart. The invite dialog
  (`InviteForm`) must fit an 800 px tall screen: role cards side by side, long lists scroll in their box,
  and the relationship label is under More options. It starts with the project it was opened from, or
  the only project (not when opened from a team). It never offers the invitation link where email is
  sent: the link signs in as the invited address.

- `ProjectMark` (project cards, the sidebar, the project header, the breadcrumbs) shows the site's favicon, on a light tile
  in both themes, with the project's first letter until one loads or when the site has none. It takes the
  project's id and address and loads `/api/projects/<id>/icon?site=<address>` (`projectIconUrl`), so the
  browser never contacts the site and app pages need no `img-src https:`. The route answers members only,
  for one of the project's stored addresses. `src/lib/app/siteIcons.ts` finds the icon the way a browser tab
  does (uier #47: sites built with Next.js declare it at paths like `/icon?<hash>` or a hashed
  `/_next/static/…/favicon.svg`): the page's `<link rel="icon">` (SVG and larger sizes first, dark-theme
  ones last), then `apple-touch-icon`, then `/favicon.ico`, `/favicon.svg` and `/apple-touch-icon.png`.
  Requests reach public addresses only (`publicLookup` from `src/lib/mcp/publicNetwork.ts` on each
  connection, public IP literals only, no `localhost` or single-label names), on ports 80, 443 or the
  address's own, follow at most 5 redirects (each checked again), take 5 s each and 10 s in all, read at
  most 512 KiB of the page and 256 KiB of an icon, and accept an icon only when its bytes are an image
  (the declared type is ignored). Found icons stay in server memory for a day, a missing one for 30 minutes;
  the browser keeps the answers as long. Icons are served as sniffed with `Content-Disposition: attachment`
  and a sandboxing CSP that `proxy.ts` sets for the route in place of the page policy, so a site's SVG never
  runs as a uier.io page. Tests set `UIER_SITE_ICONS_TEST_UPSTREAM` (local runtime only) to send every icon
  request to `e2e/support/siteIconsStub.ts`; `e2e/site-icons.api.spec.ts` covers the resolver. The icon keeps
  2 px of padding inside the 16 px tile (larger tiles set their own with `[&>img]:p-*`), so icons drawn
  edge to edge stay clear of the border and the rounded corners. The image fills the tile inside its 1 px
  border, so the 16 px tile draws a favicon at 10 px. The sidebar's active projects use a 20 px tile with
  the same 2 px padding (uier #87: with 1 px the favicon filled the tile edge to edge), so the favicon shows
  at 14 px clear of the border, like the project header and the projects list; a negative margin keeps
  the tile in the menu button's 16 px icon slot, so project names line up with Projects and My work,
  expanded, collapsed to icons and in the mobile sheet.
- **Projects list** (`(shell)/projects/page.tsx`): project cards in as many 18rem columns as the page's width holds
  (up to three; the sidebar takes part of a window). A card is one header: the favicon, the name (a link over the whole
  card) and on its line two quiet icon buttons, Open review (`ReviewLinksMenu` with `compact`: a tooltip, named
  "Open review for <project>", a menu when the project has several addresses) and More actions for admins; under the
  name one meta line with the client, who can comment and, at the line's right end, the open count inside a comment
  bubble (`CommentCountBubble`: drawn like `MessageSquareIcon` in the text colour, widening for two and three digits,
  named "11 open comments" for screen readers; uier #167), shown only while something is open (uier #169). No footer and no text button. The page renders both the active and the done list (and
  each one's empty state), and `ProjectStatusTabs` (`projects/ProjectStatusTabs.tsx`) shows the one `?status=`
  names. Active and Done are `LinkTabs` with `query`: a click writes the address with `setUrlSearchParams`
  (`push`), so the other list shows at once with no server request;
  Back, Forward and reload keep the tab, and opening a tab in a new window loads its href. Open counts come
  from `loadProjectUsage` for every listed project. `ClientFilter` still navigates (server filter) and keeps
  the status from the current address. Its menu and trigger show each client's `ClientMark` beside the name; All
  clients and No client get an empty dashed tile of the same size so the names line up.
- The project header's Open review is a menu with Review and Visit site for every address; the header does not
  repeat the addresses. On the comments page the header is as wide as the comments' filters header, the list
  with its thread or the board's columns ([comments inbox](comments-inbox.md)); the project's other pages keep the
  reading width. The install guide
  opens from the empty comments list and from Settings → Installation. It shows "Connected" with the latest
  comment's time once a comment came from one of the project's addresses, with the guide behind Show install
  guide. Its parts (`ScriptSnippet`, `PlatformSteps`, `InstallationCheck`) are exported for onboarding. The script
  is the only place the project code shows. Until `extensionDistribution()` says the extension is available, the
  browser extension tab is one line and the setup guide (`BrowserExtensionGuide`).
- **My work** (`/app/my-work`, `lib/app/myWork.ts`, in the sidebar right after Projects) lists what needs the signed-in
  member across the workspace's projects they can see: open threads assigned to them, open threads that mention them
  (`mentionsMe`), then other unread threads; each thread once, in the first group it belongs to. Each group uses a project list's order (`compareCommentOrder`:
  priority, then number, highest first; uier #292), newest first between projects' threads that tie. It
  reads the same authorized snapshot as each project's comments page (`loadProjectComments`), with each listed project's
  people to assign from the same member list, and stores nothing; a row opens its thread on its project's page (`?comment=`).
  Rows and board cards name their project with its icon before the name (`ProjectMark` from the project's first address,
  its initial until the icon loads or without one; `CommentRow`'s `projectUrl`, `BoardProject`'s `url`;
  [uier #339](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fmy-work&comment=comment_ywLI_trKSqzLKf8y0Zu8-)).
  List and Board in the header ([uier #294](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fmy-work&comment=comment_UFce1oOdSATj5MRS9lRNt); `MyWorkBoard.tsx`) show the same threads on the comments board instead
  ([comments inbox](comments-inbox.md)): one column per status, no Archive (My work leaves archived threads out), each column
  in its own sort (below; no project's saved sorts apply), and each card names its project. A card
  opens its thread in the board's sheet with its project's people, and a move (drag, or Move) is saved in the thread's own
  project with its own permissions (`allowedStatuses` reads each thread's, `useStatusChanger` takes each thread's project).
  A thread changed on the board (moved, read in the sheet, archived) that stops needing you stays there with those changes
  until My work is loaded again, so a card dropped on Done stays put and the open thread stays open; a deleted one goes
  (`removed` in `CommentUpdates`). That holds for the last thread too: the page always renders `MyWorkViews`, which shows
  the empty state itself, with no search, Filter or List/Board while it shows (`data-my-work-empty`). The choice works like a project's (`?view=`, list too, G then I or B) but is remembered
  on its own (`commentsView.ts`, scope `my-work`): choosing Board for a project's triage leaves My work's grouped lists alone,
  and the other way round. On the board the page header and the filters take the columns' width (`--board-width`, `data-header-wide`);
  a project's board does not (uier #363: full width from the left).
- **My work's search, filters and sorts** ([uier #341](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fmy-work&comment=comment_CiCbLz-eGLRCCw2eBhTDk), `MyWorkViews` in `MyWorkBoard.tsx`):
  under the page header, in the lists and on the board, the comments' own filter row (`CommentFilters`): search (`/` goes there),
  Filter and List/Board. Filter has a Project filter first (`projects`/`project`: the projects with a thread here, by name, each
  with its icon; `?project=`, "Project: Shop" in the filters in effect), then Priority, People and Only unread as in a project.
  It has no Environment and page filter (each project has its own environments and paths), no status tabs (the groups are
  mostly open threads) and no count line. Everything filters what is loaded at once and stays in the address (`?q=`,
  `?priority=`, `?people=`, `?unread=`, `?project=`), using a project's matching (`applyFilters` in `ProjectComments.tsx`).
  A list with nothing matching is left out; nothing matching anywhere shows "Nothing here" with Clear filters. On the board that message replaces only
  the columns: the board stays mounted (columns hidden), so a thread archived from the last card keeps its sheet and Restore. Each list's
  heading (`MyWorkGroups` in `MyWorkList.tsx`) and each board column's ends with its sort (`BoardSortMenu`, a list offering an
  active column's choices: Priority, the default, Newest first, Oldest first, Recently updated; Done adds Recently
  completed). The sorts are this person's, remembered in this browser (`myWorkSorts.ts`, `uier:my-work-sorts`, only choices
  other than the defaults), not saved on any project.
  `e2e/my-work.spec.ts` covers it.

### Idle comments refreshes

The project page and `GET /api/projects/<id>/comments/revision` share
`lib/app/appCommentsSnapshot.ts`. The page sends the opaque revision of its actual authorized
snapshot to `RealtimeComments`. Ready/foreground and the 60-second connected or 30-second fallback
safety checks read that revision first. An unchanged snapshot leaves the shell alone; a real
`comments.changed` notification still refreshes immediately. The RSC response, rather than the
revision response, supplies the next baseline, so a write between the check and render is included.

The check retains current session, workspace membership, project/team access, environment and
admin-only author-filter authorization. Its keyed revision covers only the rendered comments,
read cursors, follows, names/avatars, AI title settings/results, agent lease expiry, assignee options,
board policy and the current project's navigation fields. The route is `private, no-store`, varies
by Cookie and rejects cross-site browser requests. The live project-members load is shared only
within that snapshot request; there is no positive authorization cache between requests.

Other projects' names, client grouping and recent-activity order can change without this project's
notification. A full shell safety refresh remains every five visible/online minutes, or sooner on
navigation, actions and relevant comment changes. This bounds idle navigation staleness at five
minutes. In an unchanged connected hour, scheduled shell renders fall from 60 to 12 (80%); during
fallback they fall from 120 to 12 (90%). These are scheduler counts, not measured production cost
savings. Revision checks still read the comments snapshot and current authorization; they avoid
shell/header/sidebar reads, rendering and the full RSC response. `realtime.spec.ts` checks the
cadence, read/render races and late hidden-tab responses; `app-comments-snapshot.api.spec.ts`
checks revision privacy, read-state, current policy/names and lease expiry.


A synthetic in-memory service profile on 9 November 2026 counted store calls through the actual
context, project, comments, member, sidebar and header loaders, with 100 threads per project.
The render branch modeled React's request-scoped cache; the revision branch had no render cache.
With one active project, Name order used 19 calls per full render versus 16 per revision check;
Recent activity used 20 versus 16. With ten active projects, Name remained 19 versus 16 and
Recent activity used 29 versus 16. Each branch loaded the project member list once and made two
team/access queries (the shared snapshot plus the integration-link service's independent check).
These are service-operation counts from equivalent fixtures, not measured Cosmos RU, network
latency, or production savings. The browser regression independently verifies that four unchanged
minute checks make no shell RSC request and the fifth minute makes exactly one.

### Client navigation continuity

Account sections, sidebar projects, project settings, workspace tabs and breadcrumbs use Next.js
links. The Open review menu's Review setup item does too. Query-only tabs intentionally disable
prefetch because their content is already rendered; this does not force a document navigation.
Workspace selection/creation and other server-action redirects stay within the App Router.
`e2e/app-navigation.spec.ts` checks a window marker, the original toolbar host and the original
pill across these routes and Back/Forward, including Review setup.

Full navigation remains intentional for OAuth provider connect/link routes (HTTP handlers mint
state and redirect to the provider), coding-tool return URLs, review links (single-use codes and a
new tab on the reviewed site), external sites and downloads. Sign-out keeps its session-ending
server action and redirect. Crossing between marketing and `/app` keeps the document-policy
boundary: CSP and COOP belong to a document and must change together.

### Account selection

The sidebar footer's account menu lists this browser's live signed-in accounts (avatar, name and
email) and marks the active one with a check; there is no separate header for the active person
(uier #248). It shows at most three accounts, the active one always among them; with more, a
fourth row (N more accounts) is a submenu with the rest and Add account (uier #249). Below are
Sign out and, with several accounts, Sign out of all accounts (a power icon, not Sign out's
log-out icon; uier #250). The cap is five; at the cap Add account explains that one must be signed out first.
Switching opens a fresh app document on the selected account's own workspace. Sign out opens the
next live account, or sign-in when none remains. The shell sends only menu fields to the client,
never session credentials. `AccountSessionBoundary` reconciles other tabs on focus/visibility,
reconnect, pageshow and account-change events. See [sign-in](sign-in.md#several-accounts-in-one-browser)
for credential isolation and [account switching coverage](../e2e/account-switching.spec.ts).

Project/workspace tabs, project lists and My work use the app language. Titles made from a project, client, workspace or person’s saved name remain unchanged. Request-specific translations run inside the Cache Components content boundary; the static loading shell can start in English before the app provider is available.

Project links opened under the wrong account/workspace offer an explicit selection through `/app/switch-project-account`. Document preflight and RSC page reads share the project access checks; Proxy overwrites the internal original-link header to preserve the path and query. The selection page sits outside the sidebar shell.
