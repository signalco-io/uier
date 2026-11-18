// The loading-state audit's judgements (docs/design/loading-states): one entry per distinct design, the findings and
// what was seen in the code but not captured. `gallery.mjs` draws a capture run with them; `compare.mjs` sets the
// run before the redesign beside the one after it and writes the working document. What was done about each design
// is in `outcomes`, below the rules.

export const verdictNames = { eliminate: 'Eliminate', redesign: 'Redesign', improve: 'Improve', keep: 'Keep' };

/**
 * One card per rule, first match wins: the states it covers (`m`, on the capture id), what to do with them, why, and
 * what to do next. `all` shows every member in full; otherwise the first is shown and the rest as small variants.
 */
export const rules = [
    { m: /^hard-(?!denied|review|switch)|^soft-connect-error$/, section: 'Full page load', title: 'First paint of every /app address', v: 'eliminate',
        why: 'Three grey blocks flush against the window\'s top-left corner: no logo, no frame, no padding, hidden from assistive technology. Every /app address starts like this, sign-in included, because the app layout suspends its whole tree on the request\'s language. The Connect pages fall back to the same picture when opened from inside the app.',
        next: 'Make the static shell the real frame: the sidebar and panel for signed-in pages, the logo and card for the sign-in pages. Resolve the language below the frame.' },
    { m: /^hard-denied$|^(soft-auth|hard)-switch-project-account$/, section: 'Full page load', title: 'A link the account cannot open, and the account-switch page', v: 'improve',
        why: 'An empty white page first: before the "not available" message (HTTP 404) and before the account picker.',
        next: 'The status page\'s frame (logo, browser-frame picture) needs no data: draw it in the shell.' },
    { m: /^shell-enter$/, section: 'Full page load', title: 'App shell stand-in (ShellLoading)', v: 'redesign',
        why: 'A stand-in that is not the shell: a 256 px column with only the logo (its three skeleton blocks are the sidebar\'s own grey, so they do not show), one 24 px block in the top bar and the generic page blocks. Everything moves when the real sidebar and breadcrumbs replace it. On a phone it is a top bar with one block.',
        next: 'Render the real sidebar frame: Projects, My work, Workspace and Give feedback are fixed links. Placehold only the workspace switcher, the project list and the account row.' },

    { m: /^soft-projects$/, section: 'Top-level pages', title: 'Projects', v: 'redesign',
        why: 'Generic blocks for a page whose title, Create project button and Active / Done tabs never depend on data.',
        next: 'Real header and tabs in the shell; three project-card outlines in the grid.' },
    { m: /^soft-my-work$/, section: 'Top-level pages', title: 'My work', v: 'redesign',
        why: 'Generic blocks; the loaded page is a header, a filter row and grouped lists of threads.',
        next: 'Real title and filter row; reuse the comments list\'s row skeleton.' },
    { m: /^soft-projects-new$/, section: 'Top-level pages', title: 'Create project', v: 'improve',
        why: 'A good shell: heading, instructions and the onboarding steps are real. The generic block stands where the form goes, and its status reads "Loading new".',
        next: 'The fields need no data, only the client suggestions do: render the form and let the suggestions stream.' },

    { m: /^soft-project-comments-empty$/, section: 'Project', title: 'Comments of a project without comments', v: 'improve',
        why: 'The skeleton draws a full list and thread, then the page collapses to the narrower empty state.',
        next: 'The sidebar already holds the project\'s open count: when it is zero, load in the empty state\'s shape.' },
    { m: /^soft-project-comments/, section: 'Project', title: 'Comments: list and board', v: 'keep', all: true,
        why: 'The reference. The project\'s real tabs and search row, then a skeleton shaped and sized like the list with its thread, or the board\'s columns, in the view that will open. Nothing moves when the comments arrive.',
        next: 'Only the project header is still a placeholder when entering the project, although the sidebar already shows its name and favicon.' },
    { m: /^soft-project-page-checks/, section: 'Project', title: 'Page checks', v: 'keep', all: true,
        why: 'Shaped like the page: two cards, then the table with its filter and sort.',
        next: '"Across pages" and "Pages" are fixed headings: draw them for real instead of as bars.' },
    { m: /^soft-project-install/, section: 'Project', title: 'Install (onboarding)', v: 'redesign', all: true,
        why: 'The generic blocks under the project header. Onboarding\'s heading and step list are fixed but wait for the data, and the Install tab is missing from the tabs until the project loads.',
        next: 'Heading and steps in the shell, as Create project does.' },

    { m: /^soft-settings-enter$/, section: 'Project settings', title: 'Settings, entering the project', v: 'redesign',
        why: 'Header placeholder, real tabs, then the generic blocks. The settings\' section links are missing.',
        next: 'Same fix as below: section links in the shell, a section-shaped skeleton.' },
    { m: /^soft-settings-from-tab$/, section: 'Project settings', title: 'Settings, from the Comments tab', v: 'redesign',
        why: 'The section links arrive with the page, so the content jumps 216 px to the right when they do.',
        next: 'The links depend only on the person\'s role: render them in the settings layout\'s shell.' },
    { m: /^soft-settings-/, section: 'Project settings', title: 'Settings sections', v: 'redesign',
        why: 'The section links stay, which is right. The page is the same three blocks for nine different sections, each of which loads as a stack of titled cards.',
        next: 'One section-shaped skeleton: the real section titles (fixed text) over a card outline with field rows.' },

    { m: /^soft-account-enter$/, section: 'Account', title: 'Account, entering', v: 'improve',
        why: 'The best of the generic cases: the Account heading and all five section links are real and the email is one bar. The section itself is the generic blocks.',
        next: 'The section-shaped skeleton, shared with project settings.' },
    { m: /^soft-account-/, section: 'Account', title: 'Account sections', v: 'improve',
        why: 'Heading, email and section links stay. Five different sections load as the same three blocks.',
        next: 'The section-shaped skeleton, shared with project settings.' },

    { m: /^soft-workspace-enter$/, section: 'Workspace', title: 'Workspace, entering', v: 'redesign',
        why: 'The workspace\'s name and tabs are withheld, although the sidebar already shows the name and the role that decides the tabs.',
        next: 'Pass both from the shell so the header and tabs render at once.' },
    { m: /^soft-workspace-(team|person)$/, section: 'Workspace', title: 'A team, a person', v: 'redesign', all: true,
        why: 'A detail page with no header at all while it loads; the list it was opened from already had the name.',
        next: 'A header with a name bar; rows shaped like the members list.' },
    { m: /^soft-workspace-/, section: 'Workspace', title: 'Workspace tabs', v: 'redesign',
        why: 'Name and tabs stay, which is right. Users, Teams, Clients, Usage, Activity and Settings all load as the same three blocks; they are tables, card grids and forms.',
        next: 'Three shapes cover them: table rows, a card grid, a form section.' },

    { m: /^soft-auth-/, section: 'Sign-in card pages', title: 'Sign in, confirm, link an account, invitation, extension sign-in', v: 'improve',
        why: 'The logo, card and legal links are right. The blocks run edge to edge inside the card (the fallback has no padding) and the card grows when the form replaces them.',
        next: 'Sign-in\'s buttons depend only on configuration: render the form in the shell. Elsewhere, pad the fallback and give it the form\'s height.' },
    { m: /^soft-connect-request$/, section: 'Sign-in card pages', title: 'Connect a coding tool: consent', v: 'improve',
        why: 'The card frame is right. The blocks touch the card\'s edges and are not the consent\'s shape.',
        next: 'Pad the fallback like the card\'s content: a title bar, a short list, two buttons.' },

    { m: /^state-thread-shell/, section: 'Inside a loaded page', title: 'A thread opening (CommentCardShell)', v: 'keep', all: true,
        why: 'The reference for loading in place: everything the list already knows is drawn for real and inert; only what the detail adds pulses, at its final size.',
        next: 'The whole card is one live region (role="status"), so a screen reader is handed the entire thread as the announcement. Keep the status to its one hidden line.' },
    { m: /^state-thread-image$/, section: 'Inside a loaded page', title: 'A screenshot downloading (MessageImage)', v: 'keep',
        why: 'A pulsing box at the screenshot\'s final size; nothing moves when it loads.' },
    { m: /^state-board-column-more$/, section: 'Inside a loaded page', title: 'Board column loading its next page', v: 'keep',
        why: 'A 12 px spinner in the column header; its space is always reserved.' },
    { m: /^state-(board|list)-load-more$/, section: 'Inside a loaded page', title: 'Load more, in the list and on the board', v: 'improve', all: true,
        why: 'The button is disabled with a spinner and nothing stands in for the rows, so the list grows by a page when they arrive.',
        next: 'Two or three row outlines above the button while it loads.' },
    { m: /^state-(client|access)-popover$/, section: 'Inside a loaded page', title: 'Header popovers: counts and people', v: 'keep', all: true,
        why: 'One line, or three circles and a line, at the loaded row\'s height: the popover keeps its size.' },
    { m: /^state-settings-usage$/, section: 'Inside a loaded page', title: 'Usage section (AppPageLoading)', v: 'eliminate',
        why: 'A second generic page skeleton (a bar and two cards), used once, for one titled card. It pulses while the route-level skeleton is static.',
        next: 'Draw the Usage section\'s real title over a six-cell grid of bars, or load usage with the form.' },
    { m: /^state-form-saving$/, section: 'Inside a loaded page', title: 'A form saving (pending button)', v: 'keep',
        why: 'The pattern of every submit button (73 spinners in 47 files): disabled, a spinner before the label.' },

    { m: /^toolbar-starting$/, section: 'Review toolbar', title: 'Toolbar starting', v: 'keep',
        why: 'Nothing is drawn until the project answers: no pill, no pins. Deliberate, so a site never flashes a toolbar the visitor may not use.',
        next: 'Worth a look on slow connections only: the request retries once before anything shows.' },
    { m: /^toolbar-pill-comments-loading$/, section: 'Review toolbar', title: 'Pill while the comments load', v: 'keep',
        why: 'The pill is complete and usable while the comments load.' },
    { m: /^toolbar-inbox-loading$/, section: 'Review toolbar', title: 'Inbox: comments loading', v: 'redesign',
        why: 'One line of muted text where the cards go. The tabs read Active 0, Done 0, All 0 while the pill\'s badge already says 30, and the line is not a status region.',
        next: 'Two or three card outlines; no counts until they are known; role="status" on the line.' },
    { m: /^toolbar-thread-screenshot$/, section: 'Review toolbar', title: 'Thread: screenshot thumbnail', v: 'keep',
        why: 'A pulsing 96 by 64 box with the screenshot\'s ratio.' },
    { m: /^toolbar-assign-people$/, section: 'Review toolbar', title: 'Thread: people to assign', v: 'improve',
        why: 'A line of text above Unassign; the menu grows when the people arrive. The toolbar writes "..." where the app writes "…".',
        next: 'Two person-row outlines; one ellipsis style.' },
    { m: /^toolbar-accessibility-checking$/, section: 'Review toolbar', title: 'Accessibility panel: checking', v: 'keep',
        why: 'A spinner and "Checking this page..." in the panel\'s summary line while the audit script loads and runs.' },
    { m: /^toolbar-(seo|security)/, section: 'Review toolbar', title: 'SEO and Security panels: checks running', v: 'keep', all: true,
        why: 'A section that waits for a request shows a 14 px spinner and "Checking this page…" in its own box; the rest of the panel is already usable.' },

    { m: /^extension-popup-(connecting|projects-loading)$/, section: 'Browser extension', title: 'Popup: connecting', v: 'improve',
        why: 'A 120 px popup with a spinner that jumps to about 550 px when the worker answers.',
        next: 'The heading and the site\'s address are known locally: show them at once, placehold only the project list and reserve the popup\'s height.' },
    { m: /^extension-popup-/, section: 'Browser extension', title: 'Popup: pending buttons', v: 'keep', all: true,
        why: 'The UI kit\'s loading button; every other control is disabled.' },
    { m: /^extension-helper/, section: 'Browser extension', title: 'Verification window', v: 'keep', all: true,
        why: 'A purpose-built window: what is happening, one status line with a spinner, and that it closes by itself.' },

    { m: /^public-status$/, section: 'Public pages', title: 'Status: live checks', v: 'improve',
        why: 'Two lines of text with their height reserved. The services\' names are fixed.',
        next: 'Draw the service rows for real, each with its own "Checking" state.' },
    { m: /^public-notifications$/, section: 'Public pages', title: 'Notification preferences', v: 'keep',
        why: 'A line of text under the static header, with its height reserved.' },
    { m: /^public-integration$/, section: 'Public pages', title: 'Integration guide', v: 'keep',
        why: 'Shows only until the route\'s params resolve; the header is real.' },
    { m: /^public-extension-verification$/, section: 'Public pages', title: 'Extension verification bridge', v: 'keep',
        why: 'Framed by the extension and never seen: unstyled text is enough.' },
];

/**
 * What was done about a design, by its title: `done` (what changed), with `open` when part of it is still to do, or
 * `skip` (why it stayed as it was). A design with neither is still to do, or had nothing to do when it was kept.
 */
const outcomes = {
    'First paint of every /app address': {
        done: 'Each group of pages draws its own frame as its static shell (`AppBoundary`), so the first bytes of a full load are the frame: the sidebar with the app icon, the icons of Projects, My work and Give feedback and the sidebar toggle (`ShellFrame`), or the logo and an outline of the card for sign-in and a coding tool\'s consent (`AuthFrame`). Labels are bars, since text needs the language, which is now read below the frame. The app replaces the frame in place: one step from the first bytes to the page.' },
    'A link the account cannot open, and the account-switch page': {
        done: 'The entries a denied link is answered with draw `StatusPageOutline` before their message: the logo and the browser-frame picture, with bars where the text and the buttons go. The account-switch page is the sign-in card\'s frame with an outline of the card, kept until the picker arrives or the browser leaves for the project. Its blank capture came from opening it without the link it is reached from, which is a 404; it is now captured as a visit has it.',
        open: 'The first bytes of a denied document are still empty until its scripts run. Next answers a page-level `notFound()` with an empty error document that is drawn in the browser, so the outline shows only from then on. Server-rendering it means taking the 404 from the proxy\'s rewrite instead of `notFound()`, which Next does not document and Vercel would have to honor: a page-security change to verify there first.' },
    'App shell stand-in (ShellLoading)': {
        done: '`ShellLoading` is gone. `ShellFrame` is the sidebar\'s own components at their sizes, so the workspace, the projects and the account fill in where their bars were and nothing moves. Workspace is not drawn, since only some roles have it. The sidebar\'s bars use `bg-sidebar-accent`, which shows on the sidebar\'s grey. A phone gets the top bar with the sidebar toggle.' },

    'Projects': {
        done: 'The header is real while the lists load (`ProjectsLoading`): the title, Create project by the role the shell already read, and Active and Done with the sidebar\'s counts and the address\'s tab current. Under it, one card outline per project the status lists (up to nine), or the empty state\'s outline when it lists none. The client filter\'s place is kept where the shell knows a project has a client.' },
    'My work': {
        done: 'The title is the page\'s shell (`MyWorkHeader`). The loading state (`MyWorkLoading`) outlines one list with the comments list\'s rows, or the board\'s columns when the address or the remembered choice says Board. Search, Filter and List/Board exist only when something needs the person, so their row is kept free and they are not drawn.' },
    'Create project': {
        done: 'The form is in the page\'s shell (`NewProjectForm`): the addresses and the name can be typed at once and stay as typed. Only the client field\'s control is an outline behind one status, "Loading the form", and Create project is off until the page has authorized the person.' },

    'Comments of a project without comments': {
        done: 'The skeleton takes the shape the shell already knows (`useExpected`): on the Active tab a project with nothing open loads as the one box an empty list shows, at the reading width when the shell has seen no thread of it. Known limit: the shell reads threads only when the projects are ordered by recent activity, so in another order a project whose comments are all done loads as empty and then widens.' },
    'Comments: list and board': {
        done: 'The header shows the project\'s favicon and name at once, as the sidebar has them (`ProjectLoadingHeader`); the line under the name is the project\'s own data, one bar. A project the shell does not list is still all outline.' },
    'Page checks': {
        done: 'Across pages and Pages are the loaded view\'s own headings (`PageChecksHeadings`), with outlines only where data goes. A project that had no checked page in this browser (`pageChecksSeen`) loads as its one empty box, without headings to take away again.' },
    'Install (onboarding)': {
        done: 'The step list is the install page\'s shell (`InstallFrame`): it needs only the address. Each step loads as its own card (`InstallStepLoading`) with its real title, explanation and Back, Skip setup and Next, and outlines where the project goes. Entering the project on its install page draws the same (`InstallLoading`), with the Install tab current at once where the shell knows of no comment. On the project\'s other pages the Install tab still arrives with the project, at the end of the row.' },

    'Settings, entering the project': {
        done: 'While the whole project loads, `ProjectSettingsLoading` draws the section links and the section the address names, under the project\'s real name and tabs.' },
    'Settings, from the Comments tab': {
        done: 'The section links are `ProjectSettingsNav`, a client component: which sections a person sees depends only on their role, which the shell knows, so the settings layout reads nothing and has no boundary. The links are there the moment Settings opens, and the content does not jump.' },
    'Settings sections': {
        done: 'Each section loads in its own shape (`ProjectSettingsLoading`): its cards with their real titles on `SectionOutline`, outlines where the project\'s data goes, and one status per section ("Loading review", "Loading environments" and so on). What only some projects or people have is not drawn unless the shell already knows it.' },

    'Account, entering': {
        done: 'The section the address names loads in its own shape (`AccountLoading`), under the real heading and section links: General draws its five cards with their real titles.' },
    'Account sections': {
        done: 'Each section has its own shape and status (`AccountLoading`): Sign-in draws Google, Microsoft and Passkeys, and Sign out is the real card and button from the start; Notifications lists the projects the shell already has and outlines only the switches; Usage outlines two projects\' meters; Coding agents draws its five cards.' },

    'Workspace, entering': {
        done: '`WorkspaceHeader` takes the workspace\'s name and the person\'s role from the shell, so the layout has no boundary: the name and the tabs are there at once and stay mounted, focus included, while a tab loads.' },
    'A team, a person': {
        done: 'An outline of the header (a name bar; an avatar\'s circle for a person) over the page\'s sections under their real titles, with rows like the lists they hold. Edit team needs the page\'s data and is not drawn.' },
    'Workspace tabs': {
        done: 'Each tab loads in its own shape (`WorkspaceLoading`). Users keeps its line and Invite and outlines the people and the invitations under their headings. Teams keeps its toolbar. Clients and Activity keep their line. Usage lists the projects the shell already has by name, with bars for their meters. Settings draws every section under its real title.' },

    'Sign in, confirm, link an account, invitation, extension sign-in': {
        done: 'The fallback is an outline of the card\'s content inside the card\'s padding (`AuthCardOutline`), with each page\'s own number of lines and controls, so nothing touches the edges. Sign-in\'s outline is as tall as the form with every sign-in option. The form itself is not in the shell: its text needs the language and its options the deployment\'s configuration, and the static shell can read neither.' },
    'Connect a coding tool: consent': {
        done: 'The same outline in the consent\'s wider card: a title, three lines and two buttons.' },

    'A thread opening (CommentCardShell)': {
        done: 'The status is one visually hidden line, "Loading thread"; the card is `aria-busy` with inert controls. The line stays mounted and empties when the load fails, so Try again is announced.' },
    'Load more, in the list and on the board': {
        done: 'Outlines of the next page\'s first items stand in above Load more and pulse: three rows in the list, two cards in a board column, never more than remain. Only for a page the list asked for itself, never while the loaded window is read again.' },
    'Usage section (AppPageLoading)': {
        done: '`AppPageLoading` is gone. The section\'s own card stands in (`ProjectUsageLoading`): its real title over six cells of bars, pulsing, with the status "Loading usage".' },

    'Toolbar starting': {
        skip: 'Deliberate: a site never flashes a toolbar its visitor may not use. The one retry before anything shows was left as it is.' },
    'Inbox: comments loading': {
        done: 'Three card outlines where the cards go, and one under the list for its next page, with the card\'s own rows and heights. The tabs, their menus and the location picker show no count until their lists have loaded, never a 0. One hidden status says "Loading comments…". Mark all as read takes its place at once, off until the threads are there.' },
    'Thread: people to assign': {
        done: 'Two person-row outlines between Unassign and Done; the status is a hidden line. Every "..." in the toolbar\'s six languages is now "…".' },

    'Popup: connecting': {
        done: 'The worker answers a new `tab` message from its own state (the sign-in, the active tab, the review that is on), so the popup draws its heading, the site\'s address, the account controls and the footer at once, and outlines only the project list, the account\'s email and the hint. Before that first, local answer "Connecting to uier." stands at the height the popup will have.' },

    'Status: live checks': {
        done: 'The service rows are in the static shell (`serviceDefinitions`): names and descriptions are real, each row says "Checking…" where its result goes, and the results replace only that state. The section keeps its height.' },
};

/** Not loading states: a redirect that resolves before anything is drawn */
export const dropped = /^hard-review-link$/;

for (const rule of rules) Object.assign(rule, outcomes[rule.title]);
const unknown = Object.keys(outcomes).filter(title => !rules.some(rule => rule.title === title));
if (unknown.length) throw new Error(`No design is called: ${unknown.join('; ')}`);

export const notCaptured = [
    ['Pending buttons', 'About 60 forms and actions in the app (73 spinners in 47 files), the popup\'s and the toolbar\'s', 'Same pattern as "A form saving"; one is captured per surface.'],
    ['Installation check running', 'Settings → Installation, onboarding step 3', 'Needs a second window; a spinner in the button, Cancel check and a status line.'],
    ['Welcome, Join a workspace', '/app/welcome, /app/join', 'Redirect unless they apply; their fallback is the sign-in card\'s.'],
    ['Review link', '/app/review/<project>', 'Redirects to the reviewed site before anything is drawn; its fallback, the status page\'s outline, is not reachable on a full load.'],
    ['Reply editor', 'MessageComposer', 'The placeholder text stands in while the editor\'s script loads.'],
    ['Recording', 'MessageRecording, CommentRecording', '"Loading recording…" under the Play button; needs a recorded comment.'],
    ['Reviewers for verification', 'VerificationControl, CommentVerification', '"Loading reviewers…" in the select; "Saving verification…" with a spinner. Needs verification turned on.'],
    ['Thread card in an MCP client', 'src/mcp-app/thread.tsx', '"Loading thread…", then "Checking current status…".'],
    ['Toolbar: inbox next page, rewrite suggestions, sending a comment, sign out', 'CommentsSidebarCommentsList, RewriteSuggestions, CommentComposer, ToolbarOptions', 'One card outline under the last card for the next page; loading buttons; "Sending…" on the new pin.'],
    ['Integration settings: Load repositories, teams, channels, databases', 'GitHubSection, LinearSection, SlackSection, NotionSection, AzureDevOpsSection', 'Pending buttons; need a connected provider.'],
    ['Favicon and avatar fallbacks', 'ProjectMark, PersonAvatar', 'The first letter until the image loads; visible in most captures.'],
    ['Dark theme', 'Every state', 'All captures are in the light theme.'],
];

export const findings = [
    ['A full page load shows up to three different skeletons before the page.', 'Bare blocks in the window\'s corner, then a stand-in shell, then the real shell with the page\'s own fallback. The first two exist only because the language and the workspace are read above the frame.'],
    ['One generic skeleton stands in for about 45 different pages.', '`PageLoading` (a bar, a line, a block) is the fallback of 48 boundaries. It matches none of them in shape or width, and most of these pages have a title, tabs or section links that need no data.'],
    ['How deep the shell goes is uneven.', 'Project comments and Page checks, Account and Create project keep real navigation and controls. Workspace, project settings (entered from a tab), a team and a person withhold headers and links that the shell already knows.'],
    ['Four entries fall back to a bare or empty page.', 'Connect from inside the app, the account-switch page, a denied link and every first paint.'],
    ['Motion and colour follow no rule.', 'Route skeletons are static, in-place ones pulse, and `AppPageLoading` pulses at route level. The sidebar\'s skeleton is the sidebar\'s own grey and cannot be seen.'],
    ['The toolbar and the extension load in text.', '"Loading comments..." with tab counts of 0, "Loading people...", "Connecting to uier." in a popup that then triples its height. Their loaded states are far richer than their loading ones.'],
    ['Status labels are machine-made.', '"Loading new", "Loading link", "Loading confirm", "Loading connect", "Loading error": 36 labels derived from route names. The inbox\'s loading line has no status role and the thread shell makes the whole card the status.'],
];
