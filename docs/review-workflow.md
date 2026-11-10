# Review workflow

Reference for the app, project access and feedback behavior. To embed the toolbar on your site,
see the [toolbar guide](../packages/toolbar/README.md).

## The app (`/app`)

The signed-in app at [uier.io/app](https://uier.io/app) ("Get started" on the landing page), in
[`apps/web/app/(rest)/(app)`](../apps/web/app/(rest)/(app)) with its logic in
[`apps/web/src/lib/app`](../apps/web/src/lib/app). Pages are server components; changes go through server
actions that check the session and the role every time.

The app is a sidebar layout (shadcn/ui `Sidebar`, inset variant): the workspace at the top (a menu switches
between workspaces, creates a new one and, for admins, opens the workspace settings), the active projects for quick switching (their header links to all projects and, for
admins, to a new one; its Sort and Group menu sorts them by recent activity, by creation or by name and groups them by client
(once a project has one) or by status, which lists the done projects too under Active and Done, remembered in the `__Host-uier_project_order` cookie), and at the bottom Clients (once a project has a client), Users (admins), "Give feedback"
(uier's own toolbar, see [public feedback](#landing-page-showcase-and-public-feedback)) and the account menu
(account, theme, sign out). It
collapses to icons on desktop (`Ctrl/Cmd+B`) and opens as a sheet on small screens. A top bar holds the
breadcrumbs. uier is free, so there is no billing page; pricing is the landing page's `brand.pricing` promise.

- **Sign in** (`/app/sign-in`): no passwords. The app emails a single-use link and an eight-digit numeric
  code. Both expire after 15 minutes and share one request: using either invalidates both. The link token
  is stored only as a SHA-256 hash; the code only as a request-specific keyed hash, compared in constant time.
  The code works only in the browser that requested it, using the signed HttpOnly `__Host-uier_sign_in_request`
  cookie (SameSite=Lax, Secure outside local development). It expires with the request and is removed on
  sign-in. A new request in that browser replaces its binding. Type the code only where you asked to sign
  in and never share it. Invitations keep their seven-day links.
  Five wrong codes invalidate the request, including its link. Atomic counters reserve at most five guesses
  before comparison, with no window reset during the request. Rejected browser bindings do not count against
  another request. Sign-in emails remain limited to 5 per address and 20 per IP per hour, so new requests
  cannot bypass the email limits. Locally and on previews, the page shows both the link and code.
  After the email is sent, the card shows "Check your email" with the address, and the code field is focused.
  The first sign-in creates the account. Opening the link shows a "Continue" button, because email scanners
  open links before people do. A new account then sees one first-run step, `/app/welcome`: **Your name**
  (suggested from the email: `maya.tester@example.test` becomes "Maya Tester") and, when the account got a
  workspace of its own, **Workspace name** (the stored name, "Personal" for newly created workspaces).
  **Continue** saves both, **Skip** keeps the defaults; either way the step does not
  come back (`welcomePending` on the user). Sign-ins with `?next=` go straight there; `/app` shows the step on
  the next visit. The session is an HttpOnly `__Host-uier_session` cookie with a signed token (30 days;
  the key is derived from the server secret, like guest names). Signed-out visits to an app page return there
  after signing in (`proxy.ts`, `?next=`), including the toolbar's project review link.
- **Workspaces**: every user gets a workspace of their own on first sign-in and is its admin. Projects and
  members belong to a workspace; with more than one workspace the menu at the top of the sidebar switches
  between them. Every account also joins uier's own workspace, which keeps the feedback sent with Give
  feedback; the menu lists it apart from the person's workspaces as "Feedback on uier". A first workspace is
  named **Personal** until the first-run step or an admin renames it (in the workspace settings).
  Create workspace in the same menu adds another one with the name typed there, makes its
  creator the admin and opens it to add its first project; one person can create up to 20 workspaces, the first
  one included. The workspace and its admin are created together, so a creator whom an admin removed is
  never added back by opening the app again: with no other workspace, they get a new, empty one of their own.
- **Projects** (`/app/projects`): one project per reviewed site, with its addresses (the main site first,
  then staging or preview addresses), its status (active or done) and who can comment. The page shows the
  active or done projects as cards with their open comments, who can comment and review links. Both
  lists come with the page, so Active and Done switch at once, with no loading; the tab stays in the URL
  (`?status=done`) across Back, Forward and reloads. A card
  lays out its name like the project header: the favicon beside the name and the row under it, with the
  client, then who can comment; the open comments and Open review sit at the bottom. Projects is the first
  link in the sidebar. The favicon is the one the site's main page declares (`<link rel="icon">`) or keeps
  at `/favicon.ico`; uier's server fetches and serves it, so a viewer's browser never contacts the site.
  A site without one shows the project's first letter.
  An optional client name (up to 80 characters, with whitespace normalized) can be set at creation or
  in settings; the field suggests the existing clients as you type, and any other name adds a new one. It
  appears with the client's tile in project details and cards. The client filter sits beside Active/Done,
  offers All clients and No client, and stays selected in the URL (`?client=<client id>`) across status
  changes, reloads and renames. Links from before clients had ids (`?client=name:<name>`) open the id link.
  Client choices come only from projects the current member can see in the current workspace. The project
  code (12 lowercase letters and digits) is public: it is in the embed script.
  Addresses can include localhost, its subdomains, and loopback IPs for local development
  (for example `localhost:3000/app`, `preview.localhost:5173`, or `127.0.0.1:8080`). Without a
  scheme these use HTTP; other sites use HTTPS. Explicit `http://` or `https://` is preserved.
  The toolbar accepts only configured origins, including the scheme and port. Local sites
  open on the reviewer's own computer, so each reviewer needs the site running locally.
  - Onboarding: `/app/projects/new` (the addresses; the project name's placeholder is the name the main
    address gives it), then one step per screen on `/app/projects/<code>/install?onboarding=1`: **Add the script**
    (the script, the only place the project code shows, and on common platforms where to paste it and, in
    "Advanced", where the site's CSP is set and the sources to add to it), **Check installation**
    (`&step=check`) and **Invite a reviewer** (`&step=invite`): admins invite people by email for invited-only
    projects; guest projects show a plain, copyable review link for every address, main site first.
    Comments-off projects say so and link admins to Settings. Every step has one primary button: Next, Check
    installation until the site is confirmed, or Invite. Back, Skip setup (to the comments) and the progress
    (Your site, Add the script, Check installation, Invite a reviewer; every step after the site is a link)
    move between them, and Finish opens the project's comments. The install guide on its own (from the empty
    comments list or Settings → Installation; the old `/install` address without `?onboarding=1` redirects
    there) is the whole guide on one page, without the progress or the reviewer step.
  - A project has a header (name, client, who can comment, Open review and the tabs Comments, Install and
    Settings) above its pages. Open review lists every address (main site first) to review or visit, and links
    to the review setup. Hovering or clicking
    who can comment shows more info and, for admins, Invite; in guest mode that includes the guest links for every address.
  - My work `/app/my-work`: across the workspace's projects you can see, open threads assigned to you, open threads that
    mention you and other unread threads, each once; a row opens the thread on its project's comments page.
  - Comments `/app/projects/<code>`: the project's **comments**, as an inbox list or a board (Open / In progress / Ready to verify / Done).
    The header, the filters and the count line keep the app's reading width in both views. On wide screens the board
    alone is wider: its columns grow to 20rem each (four fill a 1674 px window with the sidebar open) and centre beyond that.
    Above them: search, one Filter button (priority; environment and page in one control, with environments on the left
    and that environment's pages on the right: a relative URL, or a section such as `/blog/*` for every page under it;
    people: all, assigned to me, opened by me; only unread) and List/Board, then the status tabs (Active,
    Done and All, with counts; Active, the default, is everything not done. Open, In progress and Ready to verify fold
    under Active, in the menu beside it, and the tab then reads "Active: In progress"; `?status=` keeps any other choice). Filters in effect show under the bar, each with a clear button. Each
    comment is a compact row: number, first line, author, page path (what it was left on, such as "Link in
    navigation", is in the thread's On row), then priority other than Normal (its flag, named for screen readers),
    status (a dot in the status's colour and its name, Open too, so an Active list shows where each thread is: Open ink, In progress sky, Ready to verify violet, Done green; board cards leave it to their column, and board column headers, the status menu, the Status filter and the toolbar's thread use the same colours), the assignee's avatar, age and an unread dot. A row opens its thread (`?comment=<id>`): beside the list on
    wide screens (the first shown thread until another is chosen), in the list's place on a phone (Back to comments,
    or the browser's Back), and in a sheet on the board. On the board, drag a card to another column with the mouse,
    or press and hold it on a touch screen (the page scrolls at the edges), or tap it and change the thread's status.
    From the keyboard, focus a card and press M (or Tab to its Move button, which shows only while the card has
    keyboard focus): Move lists the same columns, for screen readers too. While a card is dragged, the columns it can go to
    are dashed, the one under it is highlighted with a space where the card will land, and a column it can't go to
    is dimmed and refuses it; Escape puts the card back. Ready to verify asks for the request first. After Move, the
    focus stays on the card in its new column and screen readers hear where it went. In the list, ↓ and ↑ move to the next and the previous comment
    (stopping at the ends) and open it beside the list; on a phone-sized layout they move the focus and Enter opens the
    row. They do nothing while you type, in a menu or a dialog, or after you clicked into the open thread, where they
    scroll it. A status change (Done, Reopen, In progress) fades a row out of a list it no longer matches.
    Cards and rows move instead of jumping: one that arrives (a new thread, another person's change, a filter or search
    that now matches) fades in, one that leaves fades out where it was, and one whose status or priority changes
    travels to its new column or place while the others slide to theirs, whoever made the change. A dragged card
    settles from where it was dropped. Keyboard focus stays on a card that moves, and nothing scrolls. Nothing moves
    on page load, when switching List/Board, with reduced motion, or when more than eight cards arrive, leave or
    change column at once.
    A thread you open is marked read once it has been on screen for a moment (see
    [unread review activity](#unread-review-activity)).
    The open thread has its state menu, `#number`, unread dot (clicking it marks the comment read), Copy (Copy issue or
    Copy link, each described) and More (Follow thread and, once read, Mark as unread) on one line, then what it was
    left on (a long element selector shows only its start and end until Show full selector), its page link and source,
    priority (its flag and name, a menu of the four for those who can triage) and assignee (a menu of people for those who can assign), every
    message, Reply and the quiet Open in a connected service. Two icons after the first message's time show the screen
    size and browser it was left from;
    hovering or clicking them shows the viewport, pixel ratio, browser, OS, capture time and reviewed page,
    with Copy reproduction details for the same fields as text. The author or an admin edits and deletes it, and only admins make it
    private. The list header shows the count and unread count beside Mark all as read. Empty lists retain Install the script; invited-only projects
    also offer admins Invite with the email sign-in explanation. Comments-off lists say so and link admins
    to Settings. Filtered lists keep Nothing here.
  - Install (Settings → Installation): the install guide with the script (which contains the public project code) and **Check installation**.
    The check opens the actual configured site, confirms the script's project/API, reads comments and obtains a
    browser-verification proof without posting a test comment. CSP failures are diagnosed where browser evidence
    exists; missing scripts, private/unreachable sites, changed origins and interrupted checks stay inconclusive.
    Reports check the window, origin and a temporary nonce; no tokens, reviewer identity or page content are reported.
  - Settings `/app/projects/<code>/settings`: one page per section, listed beside it (above it on small
    screens). Everyone sees **Installation** (`/settings/installation`, the install guide) and **Notifications**
    (`/settings/notifications`), where they turn their own project emails on or off (Account → Notifications
    lists every project); for them the settings open at Notifications. Admins also have **General** (the settings
    page itself: name, optional client name and usage: comments, open, done, replies, pages, people with access),
    **Review** (who can comment: invited people, anyone with the link, or comments off; the review brief; under
    Advanced, meaningful page-state fields), **Environments** (one table of the site addresses, each with its label
    and the addresses it shares feedback with), a second card on Notifications for comment excerpts in emails,
    **People and teams**, **Integrations** (each
    provider's connection; connect and callback routes return to `/settings/integrations`) and **Danger zone**,
    which marks the project as done or reopens it, transfers it to another workspace the admin also
    administers ([project transfer](project-transfer.md)) and deletes it after the admin types its name
    ([project deletion](project-deletion.md)). Admin-only sections answer 404 for everyone else. Each page
    has one Save, off until something changed; switches save at once.
  - Review links `/app/review/<code>?url=<page>&comment=<id>` check access and redirect to the page with the
    toolbar's review link parameter `?toolbar-code=<publicId>`, a single-use code that signs the toolbar in
    (`uier-token`) and the comment to open (`uier-comment`); only addresses of the project are redirect
    targets. A link that cannot open (no access, a missing comment or a removed site address) answers 404
    with a `StatusPage` that names the signed-in account and offers Open your projects and Use another
    account (`/app/sign-in?add=1&next=<the link>`). It is a page, so link to it with a plain `<a>`, never a
    prefetching `next/link`: rendering it mints a single-use code.
  - Project embeds also try background sign-in through the hidden `/review-session` frame. A signed-in
    member can start reviewing a configured site without a link or top-level navigation. The separate
    `__Secure-uier_review_sso` HttpOnly, Secure, SameSite=None cookie only authorizes project review handoffs;
    the app session stays SameSite=Lax. Sign-in and explicit account selection write it; ordinary app
    responses never do. Older logins without it need to sign in again or select their account. Browsers that
    block cross-site cookies or frames keep the explicit link flow. No storage-access prompts are opened.
    The sidebar account menu retains up to five accounts; selecting one updates both app and review
    companion cookies without renewing the credential. A toolbar's foreground identity check follows
    that active account, clears a former identity when the new account lacks project access, and
    observes the review-only final-sign-out marker. Blocked cookies/frames still use the explicit
    authenticated review link. Native extension credentials retain their separate lifecycle.
    Toolbar sign-out disables automatic sign-in on that site until an explicit authenticated review link;
    Exit review suppresses automatic opening in that tab. Pending one-use codes survive host redirects
    in session storage for at most ten minutes and are removed after exchange or definitive rejection.
- **Workspace** (`/app/workspace`): the sidebar's Workspace opens one area with tabs for Users, Teams, Clients,
  Activity (who changed access, as sentences) and Settings (admins), or Clients alone for everyone else. The earlier addresses (`/app/users`, `/app/teams`,
  `/app/clients`, `/app/settings`) redirect to their tab.
- **Clients** (`/app/workspace/clients`): the clients of the projects the member can see, each with its tile (an icon
  or its first letter, on its colour), description, projects and how many are active or done. A client
  opens the projects list filtered to it (its done projects when none is active). Admins edit a client
  there: its name, a short description (up to 280 characters), one of twelve icons and a colour from the
  brand tokens (blue, green, amber, red, or ink). A client is a record of the workspace and projects point
  to it, so a rename shows on every project at once. Names stay unique in the workspace: a rename to
  another client's name is refused while that client has projects. A client with no projects left is no
  longer shown; a project that names it again gets it back with its details, and a rename can take its name.
  Admins also add a client there (Add client): its name, the projects it is for (each moves to it from any
  client it had) and an optional description. A name another client with projects uses, in any letter case,
  is refused.
- **Users** (`/app/workspace/users`, admins only): the people in the workspace with their role (admin or commenter)
  and the projects they review, and the pending invitations. Once there are more than eight people and
  invitations, filters show for what tells them apart: project (`?project=`), relationship, team and state. Admins
  remove people (the last admin stays), including the person who created the workspace, and revoke
  invitations. A removed member's review token stops working at once, because the review API checks the
  membership on every request.
  - Invite (a dialog from the users page, a team, a project's header (in who can comment), its People and teams
    settings or its card menu): the email, the role, for commenters the selected projects or all projects, the teams,
    and under More options the relationship label. The project it starts from, or the workspace's only project, is
    already chosen. The dialog never shows or copies the invitation link where email is sent: the link signs in
    as the invited address, so only that inbox may have it (locally and on previews the page shows it instead). The email links to `/app/invitation?token=` (single use, 7 days,
    stored only as a SHA-256 hash; 50 invitations per workspace per day). Inviting the same address again
    replaces the earlier invitation. Accepting takes a click, like signing in: it signs the invited person
    in (their account is created on first use), adds them to the workspace and opens the project's review
    link, or the projects when the invitation has no project.
- **Workspace settings** (`/app/workspace/settings`, admins only): the workspace name (up to 80 characters, on one
  line), which everyone in the workspace sees in the workspace menu and when they connect a coding tool.
  Admins open it from the Settings tab of the workspace area or the workspace menu at the top of the sidebar. The uier
  workspace that everyone joins for feedback on the app has no settings page.
- **Account** (`/app/account`): sections like a project's settings. General has the name shown with
  comments, the theme (light, dark or system) and your workspace access; Sign-in (`/app/account/sign-in`)
  has Google, Microsoft, passkeys and sign out; Coding agents (`/app/account/coding-agents`) has connected
  apps and access tokens.

### Page and comment responsiveness

The app filters loaded comments immediately when switching Active/Open/In progress/Ready to verify/Done/All, List/Board, people,
pages or unread. These choices stay in the URL and work with Back, Forward and reload. Changing
environment or author still loads a fresh authorized list from the server. Settings links show
navigation feedback, and General renders its forms before usage totals finish loading.

Status, assignment, follow and read changes update the app's cards and counts while saving,
including board moves (by drag or Move, M on a focused card; Open or In progress from Ready to verify cancels the check and lands the card there).
A failed save restores the confirmed state and shows an error; a failed automatic read only brings the
unread dot back. Mark all as read uses only the
rendered activity snapshot, keeps newer activity unread, and offers Retry for failed writes.
The toolbar likewise reflects a status change (Open, In progress, Done) immediately; comments and replies appear while sending,
with failed text kept in drafts. Destructive actions and access-setting changes wait for server
confirmation.

### Replies from the app and inbox

Use Reply on a card in the app's List or Board, or in the toolbar inbox. The inline composer
opens only for that card. You can answer Open and Done threads, including feedback on another
page or environment, page-level feedback, missing anchors and removed sources, without opening
the original page. A removed source never redirects to another address. Replying keeps the thread's
status and unread cursor; previews and composing do not mark messages read.

Enter posts, Shift+Enter adds a newline, and IME composition does not post. The keyboard shortcuts
lists (`?` in the app and in the toolbar's Options) show both keys; composers have no visible keyboard
hint and describe the keys to screen readers (the toolbar's only where a mouse or trackpad is present;
on a phone the on-screen Enter key is labelled Send instead). A selected mention
consumes Enter or Tab. Replies appear while sending; errors keep recoverable text and selected
mentions. Current access, comments-off state, private visibility, eligible mentions and the
50-message thread limit are checked on the server. Replies use the existing notifications and
integration synchronization, and capture no screenshot.

### Markdown in messages

Thread messages show their Markdown in the app (the open thread, the board's sheet) and in the toolbar
(pin popovers and the inbox), since coding agents reply in it. Messages are stored as written; only
the display changes.

- Supported: paragraphs, with every line break kept as in plain text; bold, italic, `~~strikethrough~~`,
  inline code and fenced code blocks; links, `<https://…>` and bare http(s) addresses; ordered and
  unordered lists; block quotes (a quote ends at its last `>` line, so a reply typed under it stays
  outside); headings, shown as bold text; thematic breaks. Not supported, shown as typed: tables,
  reference links, indented code, footnotes, HTML entities.
- Never HTML: tags show as text. Images are links to the image, so reading a thread never loads a
  third-party address (which would reveal readers' IP addresses). Links open only http, https and mailto
  addresses, in a new tab with `rel="noopener noreferrer nofollow ugc"`; any other link (`javascript:`,
  `data:`, a relative path) stays the text it was written as. Each link names its full address on hover,
  and link text that looks like an address on another site (`[https://uier.io](https://example.com)`)
  shows the real address instead.
- Mentions are ranges over the text: Markdown never changes or splits them, a name is never read as
  Markdown, and in code a mention shows as `@` and the name.
- Long code and addresses wrap inside the message on any screen.
- List rows (the app's inbox, board cards and My work) show the first message's first line without
  its Markdown markers. AI titles, emails, digests, feedback packets and connected services (which take
  Markdown themselves) get the text as it was written.

The parser is `@uier/toolbar/markdown`, small and written for this subset: no HTML pass-through and no
dependency in the toolbar bundle ([toolbar note](../packages/toolbar/docs/message-markdown.md)).

### Assignment and mentions

Signed-in project members can select several assignees for a thread in its toolbar details or inbox.
The assignee shows in the toolbar thread's header as their avatar, with a tooltip that names
them, and in the app's thread under Assignee as a small avatar and name (an empty dashed avatar
while unassigned). The app and toolbar use the same assignment service, with a picker that stays open between choices.
Each person has their own agent controls in the app. Assigned
to me matches any assignee and combines with page, status and search filters. Guests see the assignee's avatar and name
but cannot change assignment or look up the participant directory. Removed members appear as Former member (no access);
the assignment can be cleared or changed.

In a member's composer, type @ to search eligible participants. Arrow keys move through
suggestions; Enter or Tab selects without posting; Escape dismisses. Touch/click selects
the same account. A short opaque account suffix distinguishes duplicate display names.
Selection saves an account id and a text range, not a display-name match. Editing through
a mention turns it back into plain text. Names update when reading saved mentions; removed
accounts appear as Former member. New mention and assignment targets must currently have
project access and visibility of the thread (private threads: admins and the author).
Neither action creates membership or bypasses private-thread checks.
Assignment changes and newly selected mention recipients use the shared unread activity
cursor and five-minute email digest. A post with mentions still creates one event. Repeated
assignment selections and edits retaining the same recipients create no extra event. The
actor, read activity, muted projects, explicitly unfollowed threads, removed members and
people without private-thread access are suppressed by the shared notification delivery.
Unassignment targets the previous assignee, subject to the same rules.

### AI agents under the assignee

Each assignee can have several AI agents working under them: Claude, Codex, ChatGPT, Cursor or a
generic AI agent. Its one-colour logo (`@uier/toolbar/agents`, drawn by `AgentMark` and `AgentAvatar`) sits
on the right edge of the assignee's avatar in list rows, board cards and My work, and in the toolbar
thread's header; the avatar's name says both ("Assigned to Ana, with Claude Opus 5.5 (high reasoning)").
Under Assignee the app's thread reads "You with", the agent's logo, "Claude", the model by name without the
agent's own name ("Opus 5.5"; the reported id on hover) and the reasoning level after a dot ("· high"). Known
Claude, OpenAI, Gemini and other common model ids read as their makers write them; any other id shows as
reported, in mono. MCP packets and Markdown keep the reported id.

- **Who sets it.** Only the assignee, for themselves: **Add agent** after their name (Claude, Codex,
  ChatGPT, Cursor, AI agent), then the agent's menu changes it, opens **Session and model** (session id,
  model and reasoning level: the less common, manual path) or removes it. Other members, admins included, see it but cannot change it;
  guests never see it. The toolbar shows it and has no control for it.
- **Coding tools set it themselves.** Through MCP, a tool attaches itself under its owner when it starts
  on feedback assigned to them, with its session id, model and reasoning level ([MCP](mcp.md#agents-working-on-feedback)).
  It never attaches under someone else; for unassigned feedback it assigns its owner first, only when
  the person asked. Attaching moves an Open thread to In progress ([In progress](#in-progress)); the
  app's **Add agent** does not.
- **Each belongs to its assignee.** Removing a person, clearing all assignments, or making the thread private for an
  assignee who cannot see it removes their agents in the same write. Adding another person keeps existing agents and leases. An agent saved under an earlier
  assignee is never shown (`currentAssigneeAgent`).
- **Stored on the thread** in `assigneeAgents`, grouped by the people in `assigneeIds` (singular fields read legacy records and mirror the first entries): kind, the assignee it works under, optional session id
  (200 characters), model (100) and reasoning level (32, free text in the agent's own words), who set it and when, and the MCP connection that attached it.
  Each change advances the shared unread activity and records an `agent` event in `notificationEvents`
  (MCP `feedback.agent_changed`); agent events are never emailed. Copy issue and MCP packets include it
  for members; connected services get the assignee's name only.
- `setProjectCommentAgent` (`review/assigneeAgent.ts`) is the one service; `setCommentAgentAction` and the
  MCP tools call it. `e2e/assignee-agent.api.spec.ts` covers the rules and `e2e/assignee-agent.spec.ts`
  picking an agent, its logo in the thread and the menu, its details (reasoning level included) and its avatar on rows, the board and the toolbar.

The agent can separately report **Working now** through MCP. Its avatar then has a small spinner
throughout the app and toolbar (still with reduced motion), and the assignee card says Working now.
This is a five-minute lease, renewed every two minutes while active; expiry clears the indicator even
offline. Stopping clears only the indicator, and detaching/reassigning also ends it. The thread's
In progress status stays as it is. These transient updates add no unread activity or notifications.
See [the MCP tools](mcp.md#agents-working-on-feedback).

#### Messages an AI agent writes

A reply a coding tool posts through MCP for its owner is marked as written by the agent. The app's
thread reads "You via", the agent's logo and "Claude" after the author; hovering or clicking it shows the
model, the reasoning level and the connection it came through. The toolbar's thread reads the same with
the details in its tooltip, and emails, packets and events say "Ana via Claude".

- **Which agent.** When the agent attached under the author is the same one (the same kind, and the same
  model and reasoning level when the reply names them), the reply takes that agent's model and reasoning
  level. Otherwise it records the agent, model and reasoning level the connection gives or identifies as
  ([MCP](mcp.md#replies-written-by-an-agent)). Someone else's connection never takes the assignee's agent.
- **Stored by the server** with the message as `writtenBy` (kind, optional model and reasoning level), for
  MCP replies only. The app's and the toolbar's replies never carry it, whatever their request says, and
  the message text never sets it. Guests see "via Claude" without the model.
- **Still the person's message.** Who may edit or delete it does not change: its author edits and deletes
  it, admins delete it. Editing keeps the mark and shows "(edited)"; deleting removes both.
- Replies from before the mark keep "via" and the connection's name. Fix check requests a tool makes keep
  only the connection's name: their summary is part of the request, not a message.
- `messageAgentFor` / `messageAgentView` (`review/messageAgent.ts`) decide and show it.
  `e2e/agent-replies.api.spec.ts` covers the rules and every view; `e2e/agent-replies.spec.ts` the app's and
  the toolbar's thread.

### AI thread titles

A thread's title is a short line AI writes from its first message, so a list reads like a list of
subjects instead of the start of each message. Rows, board cards, My work and the open thread's heading
(marked "Title written by AI") show it; the first message always shows in full in the thread. Search
matches it too. Copy issue, MCP packets (`title`, and `title` in `list_feedback` items) and connected
services' issue titles (from the issue's next update) use it in place of the first message's first words.

- **Renaming.** Members who can triage (as for priority; guests never) click or focus the open thread's
  title to edit it in place, or Add a title on a thread without one: Enter or leaving the field saves,
  Escape cancels. Their title is stored as the thread's own (`manualTitle`, at most 120 characters), shows
  everywhere the AI title would (rows, cards, search, Copy issue, MCP, connected services) without the AI
  mark, also while AI titles are off, and AI never writes over it: no title is made for the thread while it
  is set. Clearing it brings the AI title back. It stays when the first message is edited and goes when
  that message is deleted.

- **Model and timing.** `claude-haiku-5-5` (`src/lib/titles/generate.ts`) with the existing
  `ANTHROPIC_API_KEY`, after the response is sent, so posting never waits for it. The thread shows its
  first line until the title is saved; the save changes the thread, so open pages refresh to it.
- **When.** For a new thread, after an edit of its first message (the old title is removed in the same
  write), after other changes to a thread without one, and for threads a list shows without one: at most
  10 per render, newest first. Threads with their own expiry (uier's public project) are titled only within
  10 minutes of a change, so a title never restarts their retention. [Costs and bounds](ai-title-costs.md).
- **Fallback.** No title (not made yet, titles off, no API key, a declined, empty, invalid or too long
  answer, a failed call) shows the first line, as before. A title made from text that has since changed is
  never shown or written.
- **Settings.** Workspace settings → AI → **Thread titles** (admins, on by default); each project's General
  settings → **Thread titles**: the workspace setting, On or Off. Existing workspaces and projects count
  as on (`aiTitles` is missing). Off makes none and hides stored ones. `UIER_AI_TITLES=off` stops them for a
  deployment and leaves rewrite suggestions on.
- **Safety.** The message, selected text and anchor words are untrusted content in tags the visitor's text
  cannot close; the prompt treats them as text to describe. The answer is a JSON object; the title is
  cleaned to plain text on one line and dropped beyond 80 characters, never cut. Quotes go only as one pair
  around the whole title; quotes that belong to it (`"C" shortcut opens …`) stay. Titles made before that
  rule which lost a quote (unbalanced quotes, no `cleanup` mark) count as missing and are made again.
- **Visibility.** Stored on the thread as `aiTitle` (text, a hash of the first message it was made from,
  model, time). It is shown only on threads the viewer can see (private threads stay private), never in
  the toolbar's thread data, and is removed when the first message is deleted. It is not part of
  `commentRevision`, `updatedAt`, sync or notifications. Emails keep naming threads by number and page:
  comment text only appears there as the opt-in excerpts.
- `e2e/ai-titles.api.spec.ts` covers the setting, the request with the API stubbed, storing, edits,
  deletion, visibility, the bounds and members' titles; `e2e/ai-titles.spec.ts` a row and the thread
  showing a title, renaming it in place, and the project setting turning it off. The Anthropic stub gives a title only for a `[stub:title:Words]`
  marker in the first message.

### Review email notifications

Owners and admins receive new feedback. Members automatically follow threads they post in, can follow or
unfollow any visible thread, and can mute project emails from the toolbar or the project's settings in the app. Guests can
optionally choose **Email me replies** after commenting and verify an address; neither email nor
an account is required to post. Related unread activity is batched for five minutes, with current
access, mute, unsubscribe and shared read-cursor checks before sending. A scheduled GitHub workflow
uses the existing production Cosmos/ACS configuration; no detached serverless work is used.
Digests say who acted, what happened and which thread/page changed, with recipient-specific mention
and assignment wording. Comment text is excluded by default. Workspace admins can enable **Include
comment excerpts** in project settings for every recipient, verified guests included; commenters
can see the setting. Quoted page text, screenshots and reproduction details stay out. Retained
failed or ambiguous attempts can keep enabled excerpts until reconciled, with no automatic expiry.

See [the delivery contract and operations guide](review-notifications.md) for defaults,
verification, retention, retry evidence, scheduler delays and the #83/#91 integration contract.

## Landing page showcase and public feedback

Every public page embeds the toolbar from the marketing layout in **showcase** mode:

```html
<script src="/toolbar.js" data-uier-mode="showcase"></script>
```

([`ToolbarScript`](../apps/web/src/components/toolbar/ToolbarScript.tsx), which renders the toolbar's React component
`<UierToolbar mode="showcase" />` from `@uier/toolbar/react`). The toolbar
is always mounted on public pages, and the landing page shows a dismissible first-run hint (with About uier to reopen it); anonymous visitors can leave point comments,
text-selection comments and replies. **Feedback is public**: every visitor sees every unresolved comment on
the page and can reply to it. Embedding options and the toolbar's modes are described in
[`packages/toolbar/README.md`](../packages/toolbar/README.md).

The static projects `uier00000001` (uier.io public feedback, guests) and `uier00000002` (uier.io user
feedback, signed-in accounts) and workspace `w_uier_public` are created in the deployment's
`app` container on the first public API request. On uier's pages a signed-in account's new feedback goes
to the user feedback project and is private to them and uier's staff; their toolbar lists their own
threads and the guests' public ones, and they reply to public threads under their account. Threads that
accounts started in the public project before the split moved once (receipt `user-feedback-split-v1`),
keeping their ids and numbers. The two starter threads are created in `comments`
with stable ids and `ttl: -1` (no expiry). Project and thread provisioning is create-only and safe across concurrent
cold starts: it preserves replies, status and numbers. Production feedback previously stored under
`uier.io` is copied once, with a persistent migration receipt; source records remain untouched.
Previews use only their configured preview containers. Local subdomains keep independent, unseeded
partitions for testing.

Every uier account automatically joins this workspace. Only accounts in the server-side
`UIER_STAFF_EMAILS` allowlist are admins (`projects: all`); everyone else is a commenter of the
feedback project, including former staff and admins previously set by hand. Existing accounts are
enrolled by a one-time, resumable provisioning backfill; sign-in and app requests reconcile roles.
Each server instance also resets stored admins on its first public-project provisioning call.
Review tokens and MCP connections (access tokens and connected apps) recheck the allowlist at read time, before that stored reset.
This grants project access directly, with no invitation email or acceptance step, and keeps each person's current workspace
and new-user onboarding as the default. Switch to the **uier** workspace to view the project.

The landing page's two starter pins and the headline's text highlight come from stored comments;
visitors reply in the toolbar's own thread, with its anonymous visitor cookie. The inbox includes
other public pages. Explicit review
links still start review mode; the signed-in app does not automatically publish a showcase.

The app's **Give feedback** button (sidebar, above the account) opens the same toolbar on the app page in
`feedback` mode, with its feedback form open (`openUierFeedback()` from `@uier/toolbar/react`); the app's C
shortcut opens it placing a comment instead (`startUierComment()`). App pages show
people's private projects, so on the public project every comment on an `/app` page is **private**: only its
author and the uier team (the public project's admins, in the app) see it, in both comments APIs, whichever
toolbar left it. Comments the team makes private there are hidden from other visitors as well.
On uier's own pages the signed-in app session takes precedence over a guest cookie or visitor header:
the toolbar profile, comments, replies, drafts and read state use the account identity and current
display name. Signed-out visitors retain their guest identity; earlier guest feedback is not claimed
by signing in. Account sign-out remains in the app's account menu.

## Screenshots

Every new element/text comment, rewrite, feedback and bug report starts a screenshot automatically
([#81](https://github.com/signalco-io/uier/issues/81)). There is no capture button or image preview in the composer.
In the form's header, `ComposerAttachmentsHeader` has a compact screen icon button with a tooltip. Its
tooltip and read-out status (its description) say what will happen: "Taking a screenshot...", then "A screenshot of this
part of the page will be attached." ("of the visible page" for feedback and bug reports), or "The screenshot could not
be taken. Only the text will be sent." Its **Omit screenshot** toggle ([#323](https://github.com/signalco-io/uier/issues/323),
a button with `aria-pressed`) sends that one comment without the `screenshot` field, so the API stores no image;
the icon shows a crossed-out screen and the status reads "No screenshot will be attached." The choice is per comment: it
stays with an open or returned (failed send) draft in memory, and the next comment, a reload or sent feedback start with
the automatic screenshot again. **Attach image**, in the bottom-left corner of the text box ([uier #155](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2F7z6v9829ezdc%2Fsettings&comment=comment_zoNUoCT0BH5rPguGnKI4t)) so it reads as a part of the comment,
or an image file pasted into the form without text, sends the reviewer's own image as `screenshot` instead of the
capture. It is checked in the browser with the saved-evidence formats and limits (`suppliedScreenshot`) and on the
server like every screenshot (`parseScreenshot`, `sanitizeScreenshot`). The file's name takes its place, with a button that
removes it; the image is never previewed, stays in memory with a returned draft and is never stored in browser storage. While a chosen or pasted image is still being read and checked, Enter and the send button wait, so the automatic screenshot is never sent in its place. The image belongs to the send it goes with: feedback opened again while one is on its way starts without it, and a failed send brings its image (and Omit screenshot) back only when no newer image was attached meanwhile; a new comment started meanwhile keeps its own image. Upload, paste and redaction on saved feedback are unchanged. Submitting waits for the capture attempt, with a 15-second limit; failures keep the text and show an unavailable
image state on saved feedback. Image-capacity or image-storage failures also preserve the text. Images are saved only with successfully posted feedback. Replies keep the original
capture and can attach one separate image through Attach image or image paste in the toolbar and app.
The same formats, limits, sanitizer, daily budget and private storage apply. Each reply shows its own
expandable image; it is read only by people who can read the thread, and removed when the reply is deleted.
Reply composers never capture the page or preview images, and image bytes stay out of local drafts. Saved inbox entries and comment details show thumbnails that expand on click, tap or keyboard activation.

The toolbar draws the capture in the reviewer's browser
([`packages/toolbar/src/screenshot.ts`](../packages/toolbar/src/screenshot.ts), with
[`modern-screenshot`](https://github.com/qq15725/modern-screenshot)), without the toolbar or inline review threads,
cut to the element/text with some room around it (the window for page feedback), as WebP (JPEG where unavailable)
of at most 480 KB. Whole-page preparation (inner scroll and offscreen checks) starts after the
composer paints and yields between short batches, like cloning, so pending input can run during capture.
Images, fonts and stylesheets from other sites that don't allow it (CORS, or the site's CSP `connect-src`),
images that haven't loaded within a second (lazy ones below the window), `<canvas>`, video, iframes and
`backdrop-filter` come out empty or plain.

For missing or unsuitable captures, the author (or a workspace admin) can choose **Upload image** or
**Paste image** on saved feedback in the toolbar: beside "No screenshot", or in the expanded screenshot next
to Redact screenshot. Keyboard image paste also works while a saved image control has focus. PNG, JPEG and WebP images use the same 512 KB / 4096 px limits as automatic evidence;
invalid images and denied clipboard access show an error and keep the saved feedback. Nothing is previewed
in a composer. Images are not persisted with drafts or in browser storage.

Expand the saved thumbnail and choose **Redact screenshot** to cover content with opaque black rectangles.
Drag with a mouse/touch, or enter left/top/width/height percentages and add an area using the keyboard.
Undo and cancel affect only the editor. **Save redaction** flattens the masks into a replacement image.
Upload, paste and redaction upload a new immutable Blob, then use an authorized, conditional transaction
to swap the image reference and comment metadata together. The previous bytes remain until success, then are deleted;
the API exposes no image history. Failed or unconfirmed saves report an error; reload to check an uncertain
network result. Image revisions prevent stale replacements. These actions count against the existing daily
image budget. They cannot erase copies someone already downloaded.

It is sent with `POST /api/comments` (or the review API) as `screenshot`, a data URL; the body of a new comment
may then be up to about 700 KB. The server checks the image type and header dimensions, then decodes
with a 4096² pixel limit and re-encodes only the first frame without metadata or trailing bytes.
Undecodable images are rejected. Newly encoded PNG, JPEG or WebP output must stay within 512 KB
and 4096 px on a side; an oversized PNG is retried as WebP. Binary bytes live in private Azure Blob Storage,
with a small reference stored in the comment’s partition
(`type: 'screenshot'`, id `$screenshot_<comment id>`, which no route accepts, with the comment's `ttl`); the comment
keeps `screenshot: { contentType, width, height, bytes, revision? }`. Authorized viewers request the image through
`GET .../comments/<id>/screenshot` (the toolbar fetches it when the thread shows it, in the inbox as it scrolls into view); the app shows it on the comment
(`/app/projects/<project>/comments/<id>/screenshot`). New clients download directly from Blob Storage with a
read-only, single-image URL valid for 60 seconds; existing clients and inline images retain their API response.
There is no CDN. A previously issued URL can remain usable for up to 60 seconds after a permission change.
See [storage, migration and deployment](screenshot-storage.md), including the updated embed CSP source. It is deleted with the comment, or with its author's text
when others replied. Failed image deletes are retried by the scheduled worker once an unreferenced
image is older than one hour. The sweep pages over image metadata and conditionally deletes the
observed version, preserving concurrent replacements. Migrated public-feedback deletes and image
replacements also remove their obsolete legacy copy. A site gets at most 300 screenshots a day.

## Draft recovery and submission retries

The toolbar keeps unsent comment, rewrite, page feedback, bug, reply and edit text in the reviewed
site's local storage for seven days after the last change. Versioned `uier:draft:v1:` keys include
the API, project, server-authorized reviewer scope, canonical page key (`@uier/toolbar/page-state`)
and thread/item. Pinned drafts retain their element/text anchor and return as closed pins without taking focus; edits retain the original text
for stale-edit protection. Closing a composer keeps its draft. Discard (Cancel for edits), a
successful submission and toolbar sign-out remove it; sign-out clears that reviewer's project
drafts on every page of the current site. Drafts on another reviewed origin must be cleared there.
Expired drafts are ignored and pruned when the toolbar next opens. A comment, rewrite, reply or edit composer that
reopens with kept text says "Draft saved in this browser" (the feedback form just shows the text again); nothing is sent to uier before posting, so the cue makes no other claim.
While a new comment or rewrite draft pin is closed, **Resume draft** above the toolbar pill scrolls to the pin
and opens it with its text, after a reload too. Browser/site scripts can read
local storage: do not type secrets into feedback. If storage is blocked or full, the draft stays
in memory and the composer explains that the page must stay open.

The app keeps reply drafts for seven days under the same versioned prefix, scoped to the app's
origin/deployment, project, authenticated account and thread. Closing, filtering, switching List/Board
or reloading keeps the text. Discard and successful posting remove it; app sign-out clears app
reply drafts on that browser origin. A different account cannot restore them. The app and reviewed
sites have independent browser storage; drafts do not synchronize between origins. A thread's pin
and inbox on the same reviewed origin share the draft for its canonical saved page and the pending-send
lock. If a failed send and newer text exceed 1000 characters together, Restore unsent text swaps
the earlier text back into the editor while retaining the newer text separately.

Images and device details are never persisted with drafts. Automatic capture is refreshed on
reopen/reload, using the restored anchor and the current page/viewport. Capture uses the resolved anchor
when available; failed capture never blocks text. Composers show no image preview, only the
capture status, the per-comment Omit screenshot choice and the name of an attached image, none stored in browser storage.
Saved screenshots keep their expandable thumbnail behavior.

Create/reply requests from the toolbar and app reply actions carry a random `idempotencyKey`, kept with the draft.
Unchanged retries keep it, including after reload; changing the submitted text/anchor/kind starts
a new attempt. Pending sends share a lock across composer instances. This is recovery of authored
work, with an explicit send action, not a background queue. Both comments APIs accept optional
keys (16–128 URL-safe characters). Receipts are scoped to the server actor and partition, shared
across create/reply operations, and reject conflicting content with 409. Capture/device changes
are excluded from the content hash so restored captures do not invalidate a retry. A replay
returns the current authorized thread, including later edits; a deleted thread returns 404 and
is never resurrected. Receipts contain hashes and ids only, expire after 30 days, and are committed
atomically with the comment/reply and optional screenshot (Cosmos single-partition batch,
conditional replacement for replies). No live Cosmos transaction is exercised by local tests.

On the public toolbar a random visitor token is kept in memory until a draft is started, then
stored as `uier:visitor`. The first successful write still sets the HttpOnly cookie. A validated
`X-Uier-Visitor` token supplies the same identity when that first write's response/cookie is lost;
an existing cookie always takes precedence. Toolbar sign-out removes both identities.

## Unread review activity

The toolbar's blue badge counts unread threads across all of the site's authorized comments. Open/Done
counts remain separate. The Unread filter includes all statuses and pages. Opening a visible short
thread acknowledges it after 800 ms in a focused foreground window; inbox previews and longer
collapsed threads require **Mark as read**: clicking the thread's blue unread dot. Reading never resolves
feedback, and resolving never acknowledges it. The app shares the same member cursor and offers Unread
and the same clickable dot. The app's open thread is acknowledged the same way, after 800 ms on screen in a
focused window: one you open from a row, a link or the board's sheet, and the first thread shown beside the
list on wide screens, which is displayed in full. On a phone that first thread is not displayed, so it stays
unread until you open it. Moving through the list with the arrow keys reads only the thread you stop on.
With Only unread, the thread you are reading stays in the list while it is open and leaves when you open
another. Already read threads send nothing; newer activity makes a thread unread again. **Mark as unread** (the toolbar's Thread options, the
app's More actions, offered once a thread with someone else's activity is read) makes the thread unread
again; an open toolbar or app thread then stays unread until it is opened again.

**Mark all as read** in the app comments list/board or toolbar inbox acknowledges only the
unread threads shown by the current filters. Replies arriving after that list was rendered stay
unread. Large lists are sent in batches of up to 200; failed writes offer Retry. Read activity
also suppresses pending email digests through the same per-reviewer cursor.

One lifecycle-managed scheduler revalidates identity/access, then active page/site lists and activity,
while the review is expanded, online and visible:

| Time since review activity | Scheduled cadence |
| --- | --- |
| Less than 1 minute | 15 seconds |
| 1 to less than 2 minutes | 30 seconds |
| 2 minutes or longer | 60 seconds (healthy idle cap) |

Review activity means a pointer press, key press, text input or wheel scroll inside uier's toolbar,
pins, popovers, inbox or inline threads. Host-page movement and scrolling do not reset it. An
interaction after entering idle refreshes immediately and restores the fast cadence; continued
interaction keeps the 15-second cadence without a request for every keystroke. A successful changed
identity, comment list or activity response also restores it (including edits that do not change
unread counts). Mutation invalidations stay immediate and separate from scheduled rounds.

Focus, reconnect, becoming visible and expansion refresh immediately and reset to 15 seconds.
Hidden, offline and collapsed reviews have no scheduled work. No timer runs during a refresh;
foreground events during a held response coalesce into one subsequent round. Ordinary deadlines
are measured from the start of a round. A round that outlasts its cadence waits one full interval
after completion, with no catch-up ticks. Query retry, deduplication and cancellation behavior is
unchanged. Timers/listeners are disposed on exit, page, environment or reviewer changes.

Healthy idle updates are discovered within 60 seconds plus the identity/content round-trip time;
active updates within 15 seconds plus that time. Network failures, suspended browsers and slow
responses can extend this bound. Every round still rechecks viewer/access; no authorization cache
is added. Observed access failures purge cached comments, activity and screenshots through the
existing access paths. Drafts, composer selection/focus, stable thread keys and open threads survive
ordinary refreshes. Refreshing never acknowledges unread activity.

Content lists retain their size limits; a separate activity projection supplies full badge/status
counts. The Unread filter fetches unread content before applying those limits, so older unread
threads remain findable. Marking a batch read reveals the next batch. The inbox warns when content
is omitted.

### Realtime and fallback refresh

On Vercel, an expanded, visible, online embedded review subscribes to comment changes over a
WebSocket. The app's project list and board use the same subscription client. A notification
refreshes authorized data in place; pending comments/replies, drafts, focus and open thread state
are preserved, and in the app the cards and rows that changed move to their new places (see the comments page above). Reconnect subscribes first and then refetches, so changes during a deployment or
network gap are recovered. The refresh itself never marks comments read; only a thread open on screen
reads the new activity it shows, after the same 800 ms as on opening.

While connected, the toolbar keeps one safety round every 60 seconds. If WebSockets are blocked
or unavailable, the adaptive 15/30/60-second cadence above applies. The app has a 30-second fallback
and a 60-second safety check while connected. The app compares an opaque revision of the current
authorized comments snapshot before idle/foreground refreshes; unchanged checks skip the full shell
render. Actual comment-change notifications still refresh immediately. A full shell safety refresh
remains every five visible/online minutes for unrelated sidebar changes. Hidden/offline views close
their socket; collapsed
reviews and unmounted pages unsubscribe. Reconnection uses exponential backoff with jitter.
The packaged extension retains its brokered adaptive HTTP refresh in this first implementation.

Changes are normally detected on the server's two-second metadata cadence plus the authorized
HTTP round trip. This is not a latency guarantee. See the [realtime protocol and cost model](api.md#realtime-comment-changes).

### Polling request measurement

On 2 November 2026, `activity.spec.ts` measured fixed 120-second windows with Playwright's clock,
with the inbox open (one page list, one site list and one activity query). Initial loads, mutations
and explicit foreground refreshes were outside the windows. Active windows used a review key press
every 15 seconds; idle windows followed two minutes without interaction. The previous fixed
15-second scheduler was measured from `b1a89f6` before implementation. Both project and same-origin
showcase contexts produced these endpoint counts:

| Scenario (each mode) | Cycles | Identity/viewer GET | Comments GET (page + site) | Activity GET | Total GET |
| --- | --- | --- | --- | --- | --- |
| Previous active or idle | 8 | 8 | 16 | 8 | 32 |
| Adaptive active | 8 | 8 | 16 | 8 | 32 |
| Adaptive settled idle | 2 | 2 | 4 | 2 | 8 |

Settled idle cycles and endpoint reads fall **75%**; the healthy maximum discovery delay rises from
15 to 60 seconds, plus round-trip time. The clock test introduces a remote update immediately
after an idle read and checks discovery at the next idle deadline, unread preservation and return
to the fast cadence. Closed inboxes have fewer active list queries, so a cycle is not a fixed
number of HTTP requests. These are local request-volume measurements, with no database/compute
cost or invoice-saving measurement. Server-side query optimization (#279) is separate.

`apps/web/src/lib/comments/activity.ts` defines the monotonic thread activity sequence. Creation,
replies, resolve/reopen, assignment changes and newly selected mention recipients advance it
atomically with the thread write. Reads and edits retaining the same recipients do not.
Actor ids stay server-side. DTO `activity` contains `sequence`, `lastOtherSequence`, `readSequence`
and `unread` (`lastOtherSequence > readSequence`). Own posts do not create unread or clear another
person's unread activity. Legacy threads derive a stable initial sequence from stored item order.

`POST /api/review/:projectId/comments/:id/read` accepts `{ sequence }` and returns the activity DTO.
It uses the existing project and private-thread access checks and authenticated actor; callers cannot
choose another reviewer. It acknowledges only the rendered sequence, rejects a future sequence, and
uses etags and `max()` across concurrent tabs. `DELETE` on the same route is Mark as unread: it moves
the reviewer's cursor back to just before the latest activity by someone else (earlier activity stays
read) and returns the activity DTO; a thread with only the reviewer's own activity, or one already
unread, is left as it is. Email digests already sent are not repeated, but a queued one for that
activity is no longer suppressed. The public showcase uses `/api/comments/:id/read` for both; its
Mark as unread creates no visitor identity.
Receipts are `review-read` documents in the existing app container, partitioned by domain/reviewer;
members use `user:<id>` across sites/devices, guests the existing hashed browser/site visitor id.
Guest receipts expire one year after the last advancing acknowledgement; member receipts persist.
Project guests fall back to page memory when local storage is blocked. Public guests can retain
their identity in the visitor cookie. Read tracking introduces no additional browser storage key.

For notification seen suppression (#84), recheck current project access and private-thread visibility,
then call `getReadSequence(domain, reviewerId, commentId)` from `comments/readState.ts` and compare the
queued activity's sequence. The read service sends no email and stores no delivery queue. Assignment
and mention producers advance `withThreadActivity` inside the same conditional write as their
authorized mutation and record recipients through the shared notification outbox.

`GET .../comments/activity` returns authorized `{ unread, open, done, total }` counts without message
text or actor ids. `GET .../comments?scope=site&unread=true` selects unread threads from the full
activity projection before fetching a bounded content batch. Both use the same private/access checks.

## Missing anchors and reattachment

Thread details distinguish exact positions, uniquely restored text, temporarily hidden targets, missing
targets and ambiguous matches. Text with several possible matches is never silently moved to the first.
Missing/ambiguous/hidden targets have no page pin; comments remain searchable/reachable in the inbox.
Authors and workspace admins can choose a new element, area or text on the same saved page and confirm or
cancel. Pointer/touch and keyboard element selection are supported; an area is dragged with a mouse or pen. The existing dockable panel and
movable toolbar retain their positions; collapse cancels selection and hides page annotations.

Reattachment updates only the position and `anchorContext` (original and immediately previous anchors,
last change time, count and revision). Messages, original quotes, screenshots, authors and status stay
unchanged. Context has the same visibility and retention as its comment; no new browser storage or
external processing is added. Server checks enforce partition/project, author/admin permission, saved
page key, original allowed origin and existing selector/offset limits. ETag retries retain concurrent
replies/status changes and recheck authorization; anchor revisions reject stale choices. No cross-page
migration or AI relocation is provided.

## Feedback environments

Project settings → Environments is one table of the site addresses. Each configured **origin** (scheme, host
and port) has a label; addresses with different paths on one origin share an environment and follow the first
one's label. Different origins are isolated by default, including older unlabeled projects: their origin is the
label. Admins choose which addresses an address **shares feedback with**, for equivalent origins such as
`example.com` and `www.example.com`: they share feedback for matching canonical page views. Sharing is stored as
an explicit group on each origin (a saved group keeps its name; a new one is named after its first address's
label or host). A label alone never groups addresses. Grouping changes the view; it does not copy or migrate
comments, change permission checks, or rewrite their source origins.

The toolbar's pins follow the current environment or explicit shared group. Its inbox picks the environment
in the same location picker as its pages (All environments by default). Counts/unread and bounded lists use the
same server-side scope. Selecting another environment changes the inbox, while new feedback is
still recorded on the site being reviewed. The filter is saved on that site for the API, project
and reviewer in `uier:environment:v1:<api>:<project>:<reviewer>` until browser data is cleared.
App filters are retained in the URL and survive reload. The app and the toolbar inbox initially
show All environments (toolbar pins still show only the current origin). Invalid/stale selections
fall back to that default. Direct comment links open the original configured origin and stored safe query/hash
state, even when aliases share feedback. Reattachment still requires the original reviewed origin. Opening a direct link overrides an old toolbar filter for
that visit. Notifications also retain the original source: unavailable sources link members to feedback history and give guests notification controls instead of a replacement site.
An allowed site that no longer responds can still fail at the browser; uier does not
proxy or provision previews.

Removed addresses remain searchable through Removed addresses or All environments, with the
recorded origin and disabled page links. Comments without a recorded origin remain in Source not
recorded or All environments; no current address is inferred for them. Re-adding the same origin
makes its links available again. Existing access, private-feedback and screenshot checks apply to
every scope. Environment isolation is a feedback view, not a separate membership boundary within
a project. No data migration or hosting changes are performed.

## Copy feedback as an issue

Saved thread details in the toolbar and app offer **Copy issue**: exact saved feedback, quotes,
anchor, permitted links, original permitted browser context, discussion and protected screenshot
references in one Markdown packet. Clipboard failures offer selectable Markdown. This is an explicit
export; it does not publish to a tracker. The shared versioned model and access rules are documented
in [Feedback context](feedback-context.md).

## Browser extension preview

The [desktop extension runtime spike](browser-extension.md) adds a signed-in review path without
an embed or changes to the site’s CSP. It is not published. Each reviewer must install it in their
own browser, and the exact origin must already belong to an accessible project. Existing comment
links are handled after Start review. Check installation continues to diagnose only the site embed;
extension activation never records an installed script. Installation offers both setup choices,
with the script selected by default; until the extension is available, its tab is one line and a link
to the setup guide. Onboarding mentions the extension only once it is available. A real store link requires owner configuration after hosted verification, browser
acceptance and store bootstrap. Each uninstrumented review-link recipient also needs the extension.
The public `/browser-extension` page and `/guides/browser-extension` setup guide describe the
published extension ([public pages](browser-extension.md#public-pages)).

## Search, priority and bulk triage

Search feedback filters the authorized app snapshot immediately. Its `q` URL parameter is limited
to 200 characters and saved with debounced history replacement. Each whitespace-separated word
must appear literally, without case sensitivity, in the first message, a non-deleted reply or quote,
the canonical page path or the public thread number (`#12`). Deleted text is excluded. Search,
priority, status, people, page and unread filters combine locally; environment and staff-author
changes still load a new server-authorized scope. People is Everyone, Assigned to me, Unassigned
(`people=unassigned`: threads with no assignee, the same threads as MCP `list_feedback` with
`assignee: "unassigned"`) or Opened by me. Back/Forward, view changes and reload retain the
URL filters. Mark all as read snapshots only the final shown threads and their rendered cursors.

Search covers at most 1,000 recent threads in the loaded environment/author scope. A notice appears
when the storage window is capped, including when private threads reduce the visible count. Narrow
the environment or staff-author scope to look for older feedback. This is not database-wide search.

Priority is Low, Normal, High or Urgent; missing priority on older records means Normal. A current
project member can change visible threads in app cards and toolbar thread/inbox views. Guests can
read the label. Ordinary accounts automatically enrolled in uier's user feedback project cannot
change priority or use bulk triage; those actions require staff there. A real priority change adds
one activity step and integration source intent, without a priority-only email. Setting the current
priority, including Normal on a legacy thread, adds neither.

A project's comments list and each board column show threads by priority (Urgent, High, Normal,
then Low), then by number, highest first: within a priority the newest request comes first.
Threads without a number (older records) follow the numbered ones of their priority, newest
first. A thread moves as soon as its priority changes, here or from realtime updates. The list's
↓/↑ keys, the thread shown first beside the list, where a dragged card lands and Select first 50 shown
follow this order. There is no other sort to choose. My work, the toolbar's
inbox and the API keep their own order (newest first).

The app shows priority as a flag in its colour beside the name: Low grey, Normal ink, High amber,
Urgent red. The open thread, its priority menu, the Priority filter and Set priority always show it;
list rows and board cards show it only for a priority other than Normal, so the threads that differ
stand out. The toolbar keeps its text label.

List and Board select threads with explicit checkboxes that stay quiet at rest: a row's box shows on hover
or keyboard focus, and on a touch screen a long press on a row or card selects it (screen readers reach the
row's box). While selecting, every row shows
its box and a bar floats over the end of the comments with Clear selection, the indeterminate Select shown
results, the selected count, assignment/unassignment, priority, Mark selected as done and Reopen selected.
x selects the focused row, Shift-click a range, Ctrl or ⌘ + A the shown results, and Escape ends selecting;
on a touch screen a tap on a row toggles it while selecting. Mark selected as done also ends In progress; Reopen selected reopens Done threads and leaves
In progress threads as they are ([In progress](#in-progress)).
Selection is limited to 50 visible threads. More results use **Select first 50 shown**, in the current
visible order (Open, In progress, Ready to verify, then Done on Board). Changing a project, environment, author, filter or view
clears selection. Threads arriving later never join a running batch. Replies and their drafts remain
scoped independently of selection and filtering.

Each batch snapshots one operation, exact ids, expected affected values and per-item submission
keys. It validates the whole request before writing, then applies at most four shared single-thread
mutations concurrently, rechecking current access, visibility and target eligibility on write retries.
Status changes additionally compare an opaque content revision. New workflow fields automatically
participate in that revision; notification/outbox bookkeeping does not. This is the extension point
for fix verification and In progress: keep status writes in `setProjectCommentResolved` and
`setProjectCommentStatus`, preserve reviewer decisions, and never infer reviewer confirmation from bulk Done.

Batches have partial success: changed, unchanged, stale, unavailable and failed counts, with a stable
result even when changed rows leave a filter. Missing and inaccessible threads share unavailable.
Successful selections clear; failed visible rows stay selected. Retry failed threads reuses the exact
operation, expected values and keys; an uncertain response keeps all original keys. Review stale
threads before starting a new action. Durable 30-day receipts prevent retries from repeating events
or overwriting later work. One revalidation follows a completed batch. Bulk read stays separate;
there is no bulk delete, privacy change, reviewer confirmation or toolbar bulk mutation.

The public [feedback triage page](https://uier.io/features/feedback-triage)
(`apps/web/app/(rest)/(marketing)/features/feedback-triage/`) states these bounds, outcomes and
permissions. Update it in the same pull request when they change.

## In progress

A thread is Open, In progress, Ready to verify or Done. In progress says someone is working on it.
It sits between Open and Ready to verify on the board, has its own status filter in the app (under Active) and a tab in the
toolbar inbox, and, like Ready to verify, counts as open: the Open tab, Open counts, My work and
`resolved: false` all include it. Board columns are exclusive.

- **Who.** The people who can mark the thread done or reopen it can set it: project members, and a
  guest on their own thread. In the app it is in the status menu and the board card's Move (M on a focused card, or a
  drag to its column); in the toolbar, the thread's status menu,
  as in the app. MCP sets it with `set_feedback_status` `status: "in-progress"`.
- **An agent starting.** A coding tool that attaches itself through MCP (`set_feedback_agent`) moves
  an Open thread to In progress in the same write, when its connection may change status
  ([agents](mcp.md#agents-working-on-feedback)). Threads already In progress, Ready to verify or Done
  keep their status, and updating or removing the agent never moves a thread. Choosing an agent in
  the app (**Add agent**) does not change the status: the assignee is right there and sets it
  themselves with the status menu, and may only be noting which tool they use.
- **Done** ends it: Done, bulk Done, a confirmed fix and a closure in a connected service clear it.
  Reopen brings a Done thread back to Open; choose In progress from Done to reopen straight into it.
- **Fix checks.** Requesting a check from In progress makes the thread Ready to verify; In progress
  is kept underneath. Still needs work moves the thread to In progress, since someone continues the
  fix. Cancel request returns it to where it was before the request (In progress or Open). In the
  app's status menu, Open and In progress on a Ready to verify thread cancel the check and land
  there, which takes the requester or an admin, as Cancel request does. A plain status write (MCP,
  the toolbar's API) to Open or In progress ends a pending check without confirmation, as Reopen does.
- **Compatibility.** Stored threads need no migration: a missing `inProgress` flag means not in
  progress. `resolved` keeps its meaning everywhere: `true` is Done and clears In progress; `false`
  reopens a Done thread to Open and leaves In progress as it is, so old clients, bulk Reopen and
  same-status polls from connected services never drop it. Connected services see In progress as open.
- **Activity.** Moving into or out of In progress is a status change: it advances unread activity,
  notifies followers by email ("moved #12 to In progress", "moved #12 back to Open"), triggers
  realtime refreshes and integration sync, and is an MCP `feedback.status_changed` event
  (`progress_started`, `progress_stopped`). It does not acknowledge reads.

## Fix verification

Verification is optional for each thread. A project member can request a fix check, add a short
summary and fix link, and choose an eligible reviewer. In the app the request starts from the
status menu's Ready to verify; in the toolbar from Request verification. Both forms submit with
Request verification and, when nobody else can check the fix, say so instead of an empty list. The original author is the default when
that identity still has access. A requester cannot choose or independently confirm themselves.
Missing authors require an eligible member selection; no identity is silently substituted.

Ready to verify remains unresolved and is included in Open counts. Its dedicated filter shows
pending checks. Board columns are exclusive: Open, In progress, Ready to verify, Done. Replies, priority,
search and selection continue to work in every state. Changes do not acknowledge unread
activity. Saving shows pending feedback; failures preserve the entered details and retry identity.

The requested reviewer can choose Confirm fix or Still needs work. Original guest authors use
their existing visitor identity without an account or email verification. A different workspace
admin can explicitly decide on the reviewer's behalf; the result names the admin and labels the
override. Still needs work moves the thread to In progress. The requester or an admin can cancel;
the thread goes back to where it was before the request, Open or In progress
([In progress](#in-progress)). Each new request gets a new id and revision;
stale decisions conflict after another request, cancellation, Done or Reopen.

Done without verification remains available while a check is pending. Ordinary Done, bulk Done,
old clients, MCP status and provider closure end pending checks without confirmation. Reopening
makes previous confirmation historical. Same-status remote Open polls preserve readiness.
The latest request and decision are retained, without an unbounded history or a second evidence
system. Original messages, source, anchor and screenshot remain unchanged.

Fix summaries are plain text, at most 500 characters. Links are at most 2,048 characters and
are never fetched or embedded. Configured review links use approved project page state; external
links require HTTPS without credentials, query or fragment state. Guest exports omit restricted
review destinations. Copy issue, MCP reads and connected-service packets include the verification
outcome and named/timed decision, alongside their compatible Open/Done status.

The public [fix verification page](https://uier.io/features/fix-verification)
(`apps/web/app/(rest)/(marketing)/features/fix-verification/`) states these labels, actor rules and
outcomes. Update it in the same pull request when they change.
