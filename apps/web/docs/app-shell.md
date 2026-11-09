# App shell, navigation and the projects list

- **Layout.** `(shell)/layout.tsx` is the sidebar (`AppSidebar`: workspace switcher (its menu switches
  workspaces, creates one (`createWorkspaceAction`, a dialog for the name) and, for admins, opens Workspace
  settings), Projects (the projects index; the person's own work goes beside it), active projects (every project when grouped by status) with a
  Create project icon link and a Sort and Group menu (`ProjectOrderMenu`) in their header, then at the bottom Workspace (admins; for everyone else only when a
  visible project has a client), Give feedback and the account menu: rows like the navigation's, the person's avatar centred in their 16px icon column so
  its name starts with the labels above; the email is in the account menu), the inset panel with the breadcrumbs
  (`AppBreadcrumbs`, from the path: one line, a long name cut short) and the one invite dialog (`InviteProvider`; `InviteButton` and
  `useInvite()` open it). The sidebar is docked from `lg` (1024 px: landscape tablets and wider), where the panel keeps
  its frame and scrolls inside it; narrower (phones, tablets in portrait) it is a sheet behind the top bar's toggle
  (`useIsMobile`, `hooks/use-mobile.ts`, in step with the `lg:` classes of `ui/sidebar.tsx` and the shell layout) and the
  page scrolls under the sticky top bar, so what sticks there (settings sections, the thread beside the list) sits
  below the bar. The sidebar's small actions (Sort and Group, Create project) keep their larger hit area on touch
  screens (`pointer-fine:after:hidden`). `PageHeader` keeps its actions on the title's row and wraps the title
  beside them; only below 20rem for the title (a phone) do they go under it. `e2e/tablet.spec.ts` (the Tablet Chrome
  project) covers portrait and landscape tablets. Pages sit in a centred reading column (`max-w-5xl`) on every page, in every view. An element that lays things
  side by side breaks out of it with the `page-wide` utility (`app/global.css`: the panel's width less the gutters, centred
  on the column; its parent must span the column) and `data-page-width="wide"`, which makes the panel a container
  (CSS `:has()`, so it follows a client-side view switch at once) for the registered `--page-wide` length the column sets.
  The rest of the page (header, filters) stays in the reading column. Only the comments board does it. uier's own workspace, which every account joins for Give feedback, is a
  `feedback` option in the switcher for people who are not its admins: its own entry after Create workspace,
  named "Feedback on uier", never in the list of their workspaces. A project's header is
  `projects/[projectId]/layout.tsx` (the favicon in `PageHeader`'s `media`, beside both the name and the row under it: client, then who can comment, whose popover has Invite for admins, Open
  review and the settings cog (`ProjectSettingsButton`, an icon link with a tooltip, current on the settings pages),
  then the `ProjectTabs`: Comments and Install (Settings → Installation and the onboarding install step) until a comment
  from one of the project's addresses arrives (`hasProjectFeedback`); after that there is nothing to switch between and
  the tabs are gone); its pages render the comments, install guide or settings under it.
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

- `ProjectMark` (project cards, the sidebar, the project header) shows the site's favicon, on a light tile
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
  1 px padding (`[&>img]:p-px`), so the favicon shows at the 16 px it is drawn for; a negative margin keeps
  the tile in the menu button's 16 px icon slot, so project names line up with Projects and My work,
  expanded, collapsed to icons and in the mobile sheet.
- **Projects list** (`(shell)/projects/page.tsx`): project cards in as many 18rem columns as the page's width holds
  (up to three; the sidebar takes part of a window). The page renders both the active and the done list (and
  each one's empty state), and `ProjectStatusTabs` (`projects/ProjectStatusTabs.tsx`) shows the one `?status=`
  names. Active and Done are `LinkTabs` with `query`: a click writes the address with `setUrlSearchParams`
  (`push`), so the other list shows at once with no server request, no spinner and no space kept for one;
  Back, Forward and reload keep the tab, and opening a tab in a new window loads its href. Open counts come
  from `loadProjectUsage` for every listed project. `ClientFilter` still navigates (server filter) and keeps
  the status from the current address.
- The project header's Open review is a menu with Review and Visit site for every address; the header does not
  repeat the addresses. The install guide
  opens from the empty comments list and from Settings → Installation. It shows "Connected" with the latest
  comment's time once a comment came from one of the project's addresses, with the guide behind Show install
  guide. Its parts (`ScriptSnippet`, `PlatformSteps`, `InstallationCheck`) are exported for onboarding. The script
  is the only place the project code shows. Until `extensionDistribution()` says the extension is available, the
  browser extension tab is one line and the setup guide (`BrowserExtensionGuide`).
- **My work** (`/app/my-work`, `lib/app/myWork.ts`, in the sidebar right after Projects) lists what needs the signed-in
  member across the workspace's projects they can see: open threads assigned to them, open threads that mention them
  (`mentionsMe`), then other unread threads; each thread once, in the first group it belongs to, newest first. It
  reads the same authorized snapshot as each project's comments page (`loadProjectComments`) and stores nothing; a
  row opens its thread on its project's page (`?comment=`). `e2e/my-work.spec.ts` covers it.
