# Loading states

Every state a person can see while something loads in the app, the review toolbar and the browser extension: what it looked like, what was done about it, and what it looks like now. Audited and captured on 2026-11-18 from a production build with local data, light theme, on a desktop (1440 × 900) and a phone (393 × 851); the "after" pictures are of 2026-11-18.

The audit held 89 states in place and found 41 distinct designs: 2 to eliminate, 11 to redesign, 11 to improve, 17 to keep. Now: 26 done, 1 partly done, 1 not changed, 13 nothing to do.

The pictures here are reduced. Full size, every route and both sizes: `apps/web/playwright-report/loading-states/compare.html` (before and after) and `index.html` (the current run) after a capture run (see [Capturing again](#capturing-again)).

## The rules

- **The frame comes first.** What a page shows without its data (its frame, navigation, headings, tabs, section links, view controls) is real UI in the shell. A skeleton fills only a place data goes.
- **A skeleton has the shape of what replaces it**: rows for a list, a titled card for a settings section, outlines for a card grid. One generic block for every page is not a loading state.
- **Nothing appears and then goes away, and nothing moves.** What depends on the data or on the person's permissions is not drawn while loading, unless the shell beside it already knows; what is drawn keeps its place and size.
- **No text before the language is known.** The app's language comes from the request (the account's, else the browser's), so the static shell of a full load has icons and bars, never words that would flash in English.
- **One rule for motion**: a shell that a navigation shows at once is still; a placeholder inside a loaded page pulses, and stops with reduced motion.
- **A status says what is loading** in words a person would use, once, in a region of its own; a count is never 0 because nothing has loaded yet.

In code: `apps/web/docs/cache-components.md` ("The frame first"), `apps/web/src/components/app/loading/outlines.tsx` (the shapes), `AppBoundary`, `ShellFrame`, `AuthFrame`, `useShellInfo`.

## Findings of the audit

1. **A full page load shows up to three different skeletons before the page.** Bare blocks in the window's corner, then a stand-in shell, then the real shell with the page's own fallback. The first two exist only because the language and the workspace are read above the frame.
2. **One generic skeleton stands in for about 45 different pages.** `PageLoading` (a bar, a line, a block) is the fallback of 48 boundaries. It matches none of them in shape or width, and most of these pages have a title, tabs or section links that need no data.
3. **How deep the shell goes is uneven.** Project comments and Page checks, Account and Create project keep real navigation and controls. Workspace, project settings (entered from a tab), a team and a person withhold headers and links that the shell already knows.
4. **Four entries fall back to a bare or empty page.** Connect from inside the app, the account-switch page, a denied link and every first paint.
5. **Motion and colour follow no rule.** Route skeletons are static, in-place ones pulse, and `AppPageLoading` pulses at route level. The sidebar's skeleton is the sidebar's own grey and cannot be seen.
6. **The toolbar and the extension load in text.** "Loading comments..." with tab counts of 0, "Loading people...", "Connecting to uier." in a popup that then triples its height. Their loaded states are far richer than their loading ones.
7. **Status labels are machine-made.** "Loading new", "Loading link", "Loading confirm", "Loading connect", "Loading error": 36 labels derived from route names. The inbox's loading line has no status role and the thread shell makes the whole card the status.

## Work list

| # | State | Was | Status |
| --- | --- | --- | --- |
| 1 | [First paint of every /app address](#1-first-paint-of-every-app-address) | Eliminate | Done |
| 2 | [A link the account cannot open, and the account-switch page](#2-a-link-the-account-cannot-open-and-the-account-switch-page) | Improve | Partly done |
| 3 | [App shell stand-in (ShellLoading)](#3-app-shell-stand-in-shellloading) | Redesign | Done |
| 4 | [Projects](#4-projects) | Redesign | Done |
| 5 | [My work](#5-my-work) | Redesign | Done |
| 6 | [Create project](#6-create-project) | Improve | Done |
| 7 | [Comments of a project without comments](#7-comments-of-a-project-without-comments) | Improve | Done |
| 8 | [Comments: list and board](#8-comments-list-and-board) | Keep | Done |
| 9 | [Page checks](#9-page-checks) | Keep | Done |
| 10 | [Install (onboarding)](#10-install-onboarding) | Redesign | Done |
| 11 | [Settings, entering the project](#11-settings-entering-the-project) | Redesign | Done |
| 12 | [Settings, from the Comments tab](#12-settings-from-the-comments-tab) | Redesign | Done |
| 13 | [Settings sections](#13-settings-sections) | Redesign | Done |
| 14 | [Account, entering](#14-account-entering) | Improve | Done |
| 15 | [Account sections](#15-account-sections) | Improve | Done |
| 16 | [Workspace, entering](#16-workspace-entering) | Redesign | Done |
| 17 | [A team, a person](#17-a-team-a-person) | Redesign | Done |
| 18 | [Workspace tabs](#18-workspace-tabs) | Redesign | Done |
| 19 | [Sign in, confirm, link an account, invitation, extension sign-in](#19-sign-in-confirm-link-an-account-invitation-extension-sign-in) | Improve | Done |
| 20 | [Connect a coding tool: consent](#20-connect-a-coding-tool-consent) | Improve | Done |
| 21 | [A thread opening (CommentCardShell)](#21-a-thread-opening-commentcardshell) | Keep | Done |
| 22 | [A screenshot downloading (MessageImage)](#22-a-screenshot-downloading-messageimage) | Keep | Nothing to do |
| 23 | [Board column loading its next page](#23-board-column-loading-its-next-page) | Keep | Nothing to do |
| 24 | [Load more, in the list and on the board](#24-load-more-in-the-list-and-on-the-board) | Improve | Done |
| 25 | [Header popovers: counts and people](#25-header-popovers-counts-and-people) | Keep | Nothing to do |
| 26 | [Usage section (AppPageLoading)](#26-usage-section-apppageloading) | Eliminate | Done |
| 27 | [A form saving (pending button)](#27-a-form-saving-pending-button) | Keep | Nothing to do |
| 28 | [Toolbar starting](#28-toolbar-starting) | Keep | Not changed |
| 29 | [Pill while the comments load](#29-pill-while-the-comments-load) | Keep | Nothing to do |
| 30 | [Inbox: comments loading](#30-inbox-comments-loading) | Redesign | Done |
| 31 | [Thread: screenshot thumbnail](#31-thread-screenshot-thumbnail) | Keep | Nothing to do |
| 32 | [Thread: people to assign](#32-thread-people-to-assign) | Improve | Done |
| 33 | [Accessibility panel: checking](#33-accessibility-panel-checking) | Keep | Nothing to do |
| 34 | [SEO and Security panels: checks running](#34-seo-and-security-panels-checks-running) | Keep | Nothing to do |
| 35 | [Popup: connecting](#35-popup-connecting) | Improve | Done |
| 36 | [Popup: pending buttons](#36-popup-pending-buttons) | Keep | Nothing to do |
| 37 | [Verification window](#37-verification-window) | Keep | Nothing to do |
| 38 | [Status: live checks](#38-status-live-checks) | Improve | Done |
| 39 | [Notification preferences](#39-notification-preferences) | Keep | Nothing to do |
| 40 | [Integration guide](#40-integration-guide) | Keep | Nothing to do |
| 41 | [Extension verification bridge](#41-extension-verification-bridge) | Keep | Nothing to do |

## Full page load

### 1. First paint of every /app address

**Was (eliminate).** Three grey blocks flush against the window's top-left corner: no logo, no frame, no padding, hidden from assistive technology. Every /app address starts like this, sign-in included, because the app layout suspends its whole tree on the request's language. The Connect pages fall back to the same picture when opened from inside the app.

**Done.** Each group of pages draws its own frame as its static shell (`AppBoundary`), so the first bytes of a full load are the frame: the sidebar with the app icon, the icons of Projects, My work and Give feedback and the sidebar toggle (`ShellFrame`), or the logo and an outline of the card for sign-in and a coding tool's consent (`AuthFrame`). Labels are bars, since text needs the language, which is now read below the frame. The app replaces the frame in place: one step from the first bytes to the page.

Covers 10 captures: Projects; My work; Project: Comments; Project: Page checks; Project: Settings; Account; Workspace: Users; Connect: error; Connect: error page, from the app; Sign in (signed out).

Before:

<img src="assets/hard-projects-before-desktop.jpg" width="440" alt="Projects, desktop, before"> <img src="assets/hard-projects-before-phone.jpg" width="118" alt="Projects, phone, before">

After (the last picture is the loaded page):

<img src="assets/hard-projects-after-desktop.jpg" width="440" alt="Projects, desktop, after"> <img src="assets/hard-projects-after-phone.jpg" width="118" alt="Projects, phone, after"> <img src="assets/hard-projects-after-loaded.jpg" width="440" alt="Projects, loaded">

### 2. A link the account cannot open, and the account-switch page

**Was (improve).** An empty white page first: before the "not available" message (HTTP 404) and before the account picker.

**Done.** The entries a denied link is answered with draw `StatusPageOutline` before their message: the logo and the browser-frame picture, with bars where the text and the buttons go. The account-switch page is the sign-in card's frame with an outline of the card, kept until the picker arrives or the browser leaves for the project. Its blank capture came from opening it without the link it is reached from, which is a 404; it is now captured as a visit has it.

**Still open.** The first bytes of a denied document are still empty until its scripts run. Next answers a page-level `notFound()` with an empty error document that is drawn in the browser, so the outline shows only from then on. Server-rendering it means taking the 404 from the proxy's rewrite instead of `notFound()`, which Next does not document and Vercel would have to honor: a page-security change to verify there first.

Covers 2 captures: A project the account cannot open (404); Switch account for a project.

Before:

<img src="assets/hard-denied-before-desktop.jpg" width="440" alt="A project the account cannot open (404), desktop, before"> <img src="assets/hard-denied-before-phone.jpg" width="118" alt="A project the account cannot open (404), phone, before">

After (the last picture is the loaded page):

<img src="assets/hard-denied-after-desktop.jpg" width="440" alt="A project the account cannot open (404), desktop, after"> <img src="assets/hard-denied-after-phone.jpg" width="118" alt="A project the account cannot open (404), phone, after"> <img src="assets/hard-denied-after-loaded.jpg" width="440" alt="A project the account cannot open (404), loaded">

After, new capture: Switch account for a project

<img src="assets/hard-switch-project-account-after-desktop.jpg" width="440" alt="Switch account for a project, desktop, after"> <img src="assets/hard-switch-project-account-after-phone.jpg" width="118" alt="Switch account for a project, phone, after"> <img src="assets/hard-switch-project-account-after-loaded.jpg" width="440" alt="Switch account for a project, loaded">

### 3. App shell stand-in (ShellLoading)

**Was (redesign).** A stand-in that is not the shell: a 256 px column with only the logo (its three skeleton blocks are the sidebar's own grey, so they do not show), one 24 px block in the top bar and the generic page blocks. Everything moves when the real sidebar and breadcrumbs replace it. On a phone it is a top bar with one block.

**Done.** `ShellLoading` is gone. `ShellFrame` is the sidebar's own components at their sizes, so the workspace, the projects and the account fill in where their bars were and nothing moves. Workspace is not drawn, since only some roles have it. The sidebar's bars use `bg-sidebar-accent`, which shows on the sidebar's grey. A phone gets the top bar with the sidebar toggle.

Before:

<img src="assets/shell-enter-before-desktop.jpg" width="440" alt="App shell (ShellLoading), desktop, before"> <img src="assets/shell-enter-before-phone.jpg" width="118" alt="App shell (ShellLoading), phone, before">

After (the last picture is the loaded page):

<img src="assets/shell-enter-after-desktop.jpg" width="440" alt="App shell (ShellLoading), desktop, after"> <img src="assets/shell-enter-after-phone.jpg" width="118" alt="App shell (ShellLoading), phone, after">

## Top-level pages

### 4. Projects

**Was (redesign).** Generic blocks for a page whose title, Create project button and Active / Done tabs never depend on data.

**Done.** The header is real while the lists load (`ProjectsLoading`): the title, Create project by the role the shell already read, and Active and Done with the sidebar's counts and the address's tab current. Under it, one card outline per project the status lists (up to nine), or the empty state's outline when it lists none. The client filter's place is kept where the shell knows a project has a client.

Before:

<img src="assets/soft-projects-before-desktop.jpg" width="440" alt="Projects, desktop, before"> <img src="assets/soft-projects-before-phone.jpg" width="118" alt="Projects, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-projects-after-desktop.jpg" width="440" alt="Projects, desktop, after"> <img src="assets/soft-projects-after-phone.jpg" width="118" alt="Projects, phone, after"> <img src="assets/soft-projects-after-loaded.jpg" width="440" alt="Projects, loaded">

### 5. My work

**Was (redesign).** Generic blocks; the loaded page is a header, a filter row and grouped lists of threads.

**Done.** The title is the page's shell (`MyWorkHeader`). The loading state (`MyWorkLoading`) outlines one list with the comments list's rows, or the board's columns when the address or the remembered choice says Board. Search, Filter and List/Board exist only when something needs the person, so their row is kept free and they are not drawn.

Before:

<img src="assets/soft-my-work-before-desktop.jpg" width="440" alt="My work, desktop, before"> <img src="assets/soft-my-work-before-phone.jpg" width="118" alt="My work, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-my-work-after-desktop.jpg" width="440" alt="My work, desktop, after"> <img src="assets/soft-my-work-after-phone.jpg" width="118" alt="My work, phone, after"> <img src="assets/soft-my-work-after-loaded.jpg" width="440" alt="My work, loaded">

### 6. Create project

**Was (improve).** A good shell: heading, instructions and the onboarding steps are real. The generic block stands where the form goes, and its status reads "Loading new".

**Done.** The form is in the page's shell (`NewProjectForm`): the addresses and the name can be typed at once and stay as typed. Only the client field's control is an outline behind one status, "Loading the form", and Create project is off until the page has authorized the person.

Before:

<img src="assets/soft-projects-new-before-desktop.jpg" width="440" alt="Create project, desktop, before"> <img src="assets/soft-projects-new-before-phone.jpg" width="118" alt="Create project, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-projects-new-after-desktop.jpg" width="440" alt="Create project, desktop, after"> <img src="assets/soft-projects-new-after-phone.jpg" width="118" alt="Create project, phone, after"> <img src="assets/soft-projects-new-after-loaded.jpg" width="440" alt="Create project, loaded">

## Project

### 7. Comments of a project without comments

**Was (improve).** The skeleton draws a full list and thread, then the page collapses to the narrower empty state.

**Done.** The skeleton takes the shape the shell already knows (`useExpected`): on the Active tab a project with nothing open loads as the one box an empty list shows, at the reading width when the shell has seen no thread of it. Known limit: the shell reads threads only when the projects are ordered by recent activity, so in another order a project whose comments are all done loads as empty and then widens.

Before:

<img src="assets/soft-project-comments-empty-before-desktop.jpg" width="440" alt="Comments, a project without comments, desktop, before"> <img src="assets/soft-project-comments-empty-before-phone.jpg" width="118" alt="Comments, a project without comments, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-project-comments-empty-after-desktop.jpg" width="440" alt="Comments, a project without comments, desktop, after"> <img src="assets/soft-project-comments-empty-after-phone.jpg" width="118" alt="Comments, a project without comments, phone, after"> <img src="assets/soft-project-comments-empty-after-loaded.jpg" width="440" alt="Comments, a project without comments, loaded">

### 8. Comments: list and board

**Was (keep).** The reference. The project's real tabs and search row, then a skeleton shaped and sized like the list with its thread, or the board's columns, in the view that will open. Nothing moves when the comments arrive.

**Done.** The header shows the project's favicon and name at once, as the sidebar has them (`ProjectLoadingHeader`); the line under the name is the project's own data, one bar. A project the shell does not list is still all outline.

Covers 5 captures: Comments (list), entering the project; Comments (list), from another tab; Comments (list, Done), from another tab; Comments (board), from another tab; Comments (board remembered), entering the project.

**Comments (list), entering the project**

Before:

<img src="assets/soft-project-comments-list-before-desktop.jpg" width="440" alt="Comments (list), entering the project, desktop, before"> <img src="assets/soft-project-comments-list-before-phone.jpg" width="118" alt="Comments (list), entering the project, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-project-comments-list-after-desktop.jpg" width="440" alt="Comments (list), entering the project, desktop, after"> <img src="assets/soft-project-comments-list-after-phone.jpg" width="118" alt="Comments (list), entering the project, phone, after"> <img src="assets/soft-project-comments-list-after-loaded.jpg" width="440" alt="Comments (list), entering the project, loaded">

**Comments (list), from another tab**

Before:

<img src="assets/soft-project-comments-tab-before-desktop.jpg" width="440" alt="Comments (list), from another tab, desktop, before"> <img src="assets/soft-project-comments-tab-before-phone.jpg" width="118" alt="Comments (list), from another tab, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-project-comments-tab-after-desktop.jpg" width="440" alt="Comments (list), from another tab, desktop, after"> <img src="assets/soft-project-comments-tab-after-phone.jpg" width="118" alt="Comments (list), from another tab, phone, after"> <img src="assets/soft-project-comments-tab-after-loaded.jpg" width="440" alt="Comments (list), from another tab, loaded">

**Comments (list, Done), from another tab**

Before:

<img src="assets/soft-project-comments-done-before-desktop.jpg" width="440" alt="Comments (list, Done), from another tab, desktop, before"> <img src="assets/soft-project-comments-done-before-phone.jpg" width="118" alt="Comments (list, Done), from another tab, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-project-comments-done-after-desktop.jpg" width="440" alt="Comments (list, Done), from another tab, desktop, after"> <img src="assets/soft-project-comments-done-after-phone.jpg" width="118" alt="Comments (list, Done), from another tab, phone, after"> <img src="assets/soft-project-comments-done-after-loaded.jpg" width="440" alt="Comments (list, Done), from another tab, loaded">

**Comments (board), from another tab**

Before:

<img src="assets/soft-project-comments-board-before-desktop.jpg" width="440" alt="Comments (board), from another tab, desktop, before"> <img src="assets/soft-project-comments-board-before-phone.jpg" width="118" alt="Comments (board), from another tab, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-project-comments-board-after-desktop.jpg" width="440" alt="Comments (board), from another tab, desktop, after"> <img src="assets/soft-project-comments-board-after-phone.jpg" width="118" alt="Comments (board), from another tab, phone, after"> <img src="assets/soft-project-comments-board-after-loaded.jpg" width="440" alt="Comments (board), from another tab, loaded">

**Comments (board remembered), entering the project**

Before:

<img src="assets/soft-project-comments-board-enter-before-desktop.jpg" width="440" alt="Comments (board remembered), entering the project, desktop, before"> <img src="assets/soft-project-comments-board-enter-before-phone.jpg" width="118" alt="Comments (board remembered), entering the project, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-project-comments-board-enter-after-desktop.jpg" width="440" alt="Comments (board remembered), entering the project, desktop, after"> <img src="assets/soft-project-comments-board-enter-after-phone.jpg" width="118" alt="Comments (board remembered), entering the project, phone, after"> <img src="assets/soft-project-comments-board-enter-after-loaded.jpg" width="440" alt="Comments (board remembered), entering the project, loaded">

### 9. Page checks

**Was (keep).** Shaped like the page: two cards, then the table with its filter and sort.

**Done.** Across pages and Pages are the loaded view's own headings (`PageChecksHeadings`), with outlines only where data goes. A project that had no checked page in this browser (`pageChecksSeen`) loads as its one empty box, without headings to take away again.

Covers 2 captures: Page checks, entering the project; Page checks, from another tab.

**Page checks, entering the project**

Before:

<img src="assets/soft-project-page-checks-enter-before-desktop.jpg" width="440" alt="Page checks, entering the project, desktop, before"> <img src="assets/soft-project-page-checks-enter-before-phone.jpg" width="118" alt="Page checks, entering the project, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-project-page-checks-enter-after-desktop.jpg" width="440" alt="Page checks, entering the project, desktop, after"> <img src="assets/soft-project-page-checks-enter-after-phone.jpg" width="118" alt="Page checks, entering the project, phone, after"> <img src="assets/soft-project-page-checks-enter-after-loaded.jpg" width="440" alt="Page checks, entering the project, loaded">

**Page checks, from another tab**

Before:

<img src="assets/soft-project-page-checks-tab-before-desktop.jpg" width="440" alt="Page checks, from another tab, desktop, before"> <img src="assets/soft-project-page-checks-tab-before-phone.jpg" width="118" alt="Page checks, from another tab, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-project-page-checks-tab-after-desktop.jpg" width="440" alt="Page checks, from another tab, desktop, after"> <img src="assets/soft-project-page-checks-tab-after-phone.jpg" width="118" alt="Page checks, from another tab, phone, after"> <img src="assets/soft-project-page-checks-tab-after-loaded.jpg" width="440" alt="Page checks, from another tab, loaded">

### 10. Install (onboarding)

**Was (redesign).** The generic blocks under the project header. Onboarding's heading and step list are fixed but wait for the data, and the Install tab is missing from the tabs until the project loads.

**Done.** The step list is the install page's shell (`InstallFrame`): it needs only the address. Each step loads as its own card (`InstallStepLoading`) with its real title, explanation and Back, Skip setup and Next, and outlines where the project goes. Entering the project on its install page draws the same (`InstallLoading`), with the Install tab current at once where the shell knows of no comment. On the project's other pages the Install tab still arrives with the project, at the end of the row.

Covers 2 captures: Install, entering the project; Install, from another tab.

**Install, entering the project**

Before:

<img src="assets/soft-project-install-enter-before-desktop.jpg" width="440" alt="Install, entering the project, desktop, before"> <img src="assets/soft-project-install-enter-before-phone.jpg" width="118" alt="Install, entering the project, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-project-install-enter-after-desktop.jpg" width="440" alt="Install, entering the project, desktop, after"> <img src="assets/soft-project-install-enter-after-phone.jpg" width="118" alt="Install, entering the project, phone, after"> <img src="assets/soft-project-install-enter-after-loaded.jpg" width="440" alt="Install, entering the project, loaded">

**Install, from another tab**

Before:

<img src="assets/soft-project-install-tab-before-desktop.jpg" width="440" alt="Install, from another tab, desktop, before"> <img src="assets/soft-project-install-tab-before-phone.jpg" width="118" alt="Install, from another tab, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-project-install-tab-after-desktop.jpg" width="440" alt="Install, from another tab, desktop, after"> <img src="assets/soft-project-install-tab-after-phone.jpg" width="118" alt="Install, from another tab, phone, after"> <img src="assets/soft-project-install-tab-after-loaded.jpg" width="440" alt="Install, from another tab, loaded">

## Project settings

### 11. Settings, entering the project

**Was (redesign).** Header placeholder, real tabs, then the generic blocks. The settings' section links are missing.

**Done.** While the whole project loads, `ProjectSettingsLoading` draws the section links and the section the address names, under the project's real name and tabs.

Before:

<img src="assets/soft-settings-enter-before-desktop.jpg" width="440" alt="General, entering the project, desktop, before"> <img src="assets/soft-settings-enter-before-phone.jpg" width="118" alt="General, entering the project, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-settings-enter-after-desktop.jpg" width="440" alt="General, entering the project, desktop, after"> <img src="assets/soft-settings-enter-after-phone.jpg" width="118" alt="General, entering the project, phone, after"> <img src="assets/soft-settings-enter-after-loaded.jpg" width="440" alt="General, entering the project, loaded">

### 12. Settings, from the Comments tab

**Was (redesign).** The section links arrive with the page, so the content jumps 216 px to the right when they do.

**Done.** The section links are `ProjectSettingsNav`, a client component: which sections a person sees depends only on their role, which the shell knows, so the settings layout reads nothing and has no boundary. The links are there the moment Settings opens, and the content does not jump.

Before:

<img src="assets/soft-settings-from-tab-before-desktop.jpg" width="440" alt="General, from the Comments tab, desktop, before"> <img src="assets/soft-settings-from-tab-before-phone.jpg" width="118" alt="General, from the Comments tab, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-settings-from-tab-after-desktop.jpg" width="440" alt="General, from the Comments tab, desktop, after"> <img src="assets/soft-settings-from-tab-after-phone.jpg" width="118" alt="General, from the Comments tab, phone, after"> <img src="assets/soft-settings-from-tab-after-loaded.jpg" width="440" alt="General, from the Comments tab, loaded">

### 13. Settings sections

**Was (redesign).** The section links stay, which is right. The page is the same three blocks for nine different sections, each of which loads as a stack of titled cards.

**Done.** Each section loads in its own shape (`ProjectSettingsLoading`): its cards with their real titles on `SectionOutline`, outlines where the project's data goes, and one status per section ("Loading review", "Loading environments" and so on). What only some projects or people have is not drawn unless the shell already knows it.

Covers 9 captures: General, from another section; Review; People and teams; Notifications; Environments; Installation; Integrations; Integration: GitHub; Danger zone.

Before:

<img src="assets/soft-settings-general-before-desktop.jpg" width="440" alt="General, from another section, desktop, before"> <img src="assets/soft-settings-general-before-phone.jpg" width="118" alt="General, from another section, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-settings-general-after-desktop.jpg" width="440" alt="General, from another section, desktop, after"> <img src="assets/soft-settings-general-after-phone.jpg" width="118" alt="General, from another section, phone, after"> <img src="assets/soft-settings-general-after-loaded.jpg" width="440" alt="General, from another section, loaded">

## Account

### 14. Account, entering

**Was (improve).** The best of the generic cases: the Account heading and all five section links are real and the email is one bar. The section itself is the generic blocks.

**Done.** The section the address names loads in its own shape (`AccountLoading`), under the real heading and section links: General draws its five cards with their real titles.

Before:

<img src="assets/soft-account-enter-before-desktop.jpg" width="440" alt="General, entering Account, desktop, before"> <img src="assets/soft-account-enter-before-phone.jpg" width="118" alt="General, entering Account, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-account-enter-after-desktop.jpg" width="440" alt="General, entering Account, desktop, after"> <img src="assets/soft-account-enter-after-phone.jpg" width="118" alt="General, entering Account, phone, after"> <img src="assets/soft-account-enter-after-loaded.jpg" width="440" alt="General, entering Account, loaded">

### 15. Account sections

**Was (improve).** Heading, email and section links stay. Five different sections load as the same three blocks.

**Done.** Each section has its own shape and status (`AccountLoading`): Sign-in draws Google, Microsoft and Passkeys, and Sign out is the real card and button from the start; Notifications lists the projects the shell already has and outlines only the switches; Usage outlines two projects' meters; Coding agents draws its five cards.

Covers 5 captures: General, from another section; Sign-in; Notifications; Usage; Coding agents.

Before:

<img src="assets/soft-account-general-before-desktop.jpg" width="440" alt="General, from another section, desktop, before"> <img src="assets/soft-account-general-before-phone.jpg" width="118" alt="General, from another section, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-account-general-after-desktop.jpg" width="440" alt="General, from another section, desktop, after"> <img src="assets/soft-account-general-after-phone.jpg" width="118" alt="General, from another section, phone, after"> <img src="assets/soft-account-general-after-loaded.jpg" width="440" alt="General, from another section, loaded">

## Workspace

### 16. Workspace, entering

**Was (redesign).** The workspace's name and tabs are withheld, although the sidebar already shows the name and the role that decides the tabs.

**Done.** `WorkspaceHeader` takes the workspace's name and the person's role from the shell, so the layout has no boundary: the name and the tabs are there at once and stay mounted, focus included, while a tab loads.

Before:

<img src="assets/soft-workspace-enter-before-desktop.jpg" width="440" alt="Users, entering Workspace, desktop, before"> <img src="assets/soft-workspace-enter-before-phone.jpg" width="118" alt="Users, entering Workspace, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-workspace-enter-after-desktop.jpg" width="440" alt="Users, entering Workspace, desktop, after"> <img src="assets/soft-workspace-enter-after-phone.jpg" width="118" alt="Users, entering Workspace, phone, after"> <img src="assets/soft-workspace-enter-after-loaded.jpg" width="440" alt="Users, entering Workspace, loaded">

### 17. A team, a person

**Was (redesign).** A detail page with no header at all while it loads; the list it was opened from already had the name.

**Done.** An outline of the header (a name bar; an avatar's circle for a person) over the page's sections under their real titles, with rows like the lists they hold. Edit team needs the page's data and is not drawn.

Covers 2 captures: A team; A person.

**A team**

Before:

<img src="assets/soft-workspace-team-before-desktop.jpg" width="440" alt="A team, desktop, before"> <img src="assets/soft-workspace-team-before-phone.jpg" width="118" alt="A team, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-workspace-team-after-desktop.jpg" width="440" alt="A team, desktop, after"> <img src="assets/soft-workspace-team-after-phone.jpg" width="118" alt="A team, phone, after"> <img src="assets/soft-workspace-team-after-loaded.jpg" width="440" alt="A team, loaded">

**A person**

Before:

<img src="assets/soft-workspace-person-before-desktop.jpg" width="440" alt="A person, desktop, before"> <img src="assets/soft-workspace-person-before-phone.jpg" width="118" alt="A person, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-workspace-person-after-desktop.jpg" width="440" alt="A person, desktop, after"> <img src="assets/soft-workspace-person-after-phone.jpg" width="118" alt="A person, phone, after"> <img src="assets/soft-workspace-person-after-loaded.jpg" width="440" alt="A person, loaded">

### 18. Workspace tabs

**Was (redesign).** Name and tabs stay, which is right. Users, Teams, Clients, Usage, Activity and Settings all load as the same three blocks; they are tables, card grids and forms.

**Done.** Each tab loads in its own shape (`WorkspaceLoading`). Users keeps its line and Invite and outlines the people and the invitations under their headings. Teams keeps its toolbar. Clients and Activity keep their line. Usage lists the projects the shell already has by name, with bars for their meters. Settings draws every section under its real title.

Covers 6 captures: Users, from another tab; Teams; Clients; Usage; Activity; Settings.

Before:

<img src="assets/soft-workspace-users-before-desktop.jpg" width="440" alt="Users, from another tab, desktop, before"> <img src="assets/soft-workspace-users-before-phone.jpg" width="118" alt="Users, from another tab, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-workspace-users-after-desktop.jpg" width="440" alt="Users, from another tab, desktop, after"> <img src="assets/soft-workspace-users-after-phone.jpg" width="118" alt="Users, from another tab, phone, after"> <img src="assets/soft-workspace-users-after-loaded.jpg" width="440" alt="Users, from another tab, loaded">

## Sign-in card pages

### 19. Sign in, confirm, link an account, invitation, extension sign-in

**Was (improve).** The logo, card and legal links are right. The blocks run edge to edge inside the card (the fallback has no padding) and the card grows when the form replaces them.

**Done.** The fallback is an outline of the card's content inside the card's padding (`AuthCardOutline`), with each page's own number of lines and controls, so nothing touches the edges. Sign-in's outline is as tall as the form with every sign-in option. The form itself is not in the shell: its text needs the language and its options the deployment's configuration, and the static shell can read neither.

Covers 6 captures: Browser extension sign-in; Sign in; Sign in: confirm; Sign in: link Google; Sign in: link Microsoft; Invitation.

Before:

<img src="assets/soft-auth-extension-before-desktop.jpg" width="440" alt="Browser extension sign-in, desktop, before"> <img src="assets/soft-auth-extension-before-phone.jpg" width="118" alt="Browser extension sign-in, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-auth-extension-after-desktop.jpg" width="440" alt="Browser extension sign-in, desktop, after"> <img src="assets/soft-auth-extension-after-phone.jpg" width="118" alt="Browser extension sign-in, phone, after">

### 20. Connect a coding tool: consent

**Was (improve).** The card frame is right. The blocks touch the card's edges and are not the consent's shape.

**Done.** The same outline in the consent's wider card: a title, three lines and two buttons.

Before:

<img src="assets/soft-connect-request-before-desktop.jpg" width="440" alt="Connect: consent, from the error page, desktop, before"> <img src="assets/soft-connect-request-before-phone.jpg" width="118" alt="Connect: consent, from the error page, phone, before">

After (the last picture is the loaded page):

<img src="assets/soft-connect-request-after-desktop.jpg" width="440" alt="Connect: consent, from the error page, desktop, after"> <img src="assets/soft-connect-request-after-phone.jpg" width="118" alt="Connect: consent, from the error page, phone, after">

## Inside a loaded page

### 21. A thread opening (CommentCardShell)

**Was (keep).** The reference for loading in place: everything the list already knows is drawn for real and inert; only what the detail adds pulses, at its final size.

**Done.** The status is one visually hidden line, "Loading thread"; the card is `aria-busy` with inert controls. The line stays mounted and empties when the load fails, so Try again is announced.

Covers 2 captures: Thread opening in the list (CommentCardShell); Thread opening on the board (sheet).

**Thread opening in the list (CommentCardShell)**

Before:

<img src="assets/state-thread-shell-list-before-desktop.jpg" width="440" alt="Thread opening in the list (CommentCardShell), desktop, before"> <img src="assets/state-thread-shell-list-before-phone.jpg" width="118" alt="Thread opening in the list (CommentCardShell), phone, before">

After (the last picture is the loaded page):

<img src="assets/state-thread-shell-list-after-desktop.jpg" width="440" alt="Thread opening in the list (CommentCardShell), desktop, after"> <img src="assets/state-thread-shell-list-after-phone.jpg" width="118" alt="Thread opening in the list (CommentCardShell), phone, after"> <img src="assets/state-thread-shell-list-after-loaded.jpg" width="440" alt="Thread opening in the list (CommentCardShell), loaded">

**Thread opening on the board (sheet)**

Before:

<img src="assets/state-thread-shell-board-before-desktop.jpg" width="440" alt="Thread opening on the board (sheet), desktop, before"> <img src="assets/state-thread-shell-board-before-phone.jpg" width="118" alt="Thread opening on the board (sheet), phone, before">

After (the last picture is the loaded page):

<img src="assets/state-thread-shell-board-after-desktop.jpg" width="440" alt="Thread opening on the board (sheet), desktop, after"> <img src="assets/state-thread-shell-board-after-phone.jpg" width="118" alt="Thread opening on the board (sheet), phone, after"> <img src="assets/state-thread-shell-board-after-loaded.jpg" width="440" alt="Thread opening on the board (sheet), loaded">

### 22. A screenshot downloading (MessageImage)

**Was (keep).** A pulsing box at the screenshot's final size; nothing moves when it loads.

Before:

<img src="assets/state-thread-image-before-desktop.jpg" width="440" alt="Screenshot downloading in a thread (MessageImage), desktop, before"> <img src="assets/state-thread-image-before-phone.jpg" width="118" alt="Screenshot downloading in a thread (MessageImage), phone, before">

After (the last picture is the loaded page):

<img src="assets/state-thread-image-after-desktop.jpg" width="440" alt="Screenshot downloading in a thread (MessageImage), desktop, after"> <img src="assets/state-thread-image-after-phone.jpg" width="118" alt="Screenshot downloading in a thread (MessageImage), phone, after">

### 23. Board column loading its next page

**Was (keep).** A 12 px spinner in the column header; its space is always reserved.

Before:

<img src="assets/state-board-column-more-before-desktop.jpg" width="440" alt="Board column loading its next page, desktop, before"> <img src="assets/state-board-column-more-before-phone.jpg" width="118" alt="Board column loading its next page, phone, before">

After (the last picture is the loaded page):

<img src="assets/state-board-column-more-after-desktop.jpg" width="440" alt="Board column loading its next page, desktop, after"> <img src="assets/state-board-column-more-after-phone.jpg" width="118" alt="Board column loading its next page, phone, after">

### 24. Load more, in the list and on the board

**Was (improve).** The button is disabled with a spinner and nothing stands in for the rows, so the list grows by a page when they arrive.

**Done.** Outlines of the next page's first items stand in above Load more and pulse: three rows in the list, two cards in a board column, never more than remain. Only for a page the list asked for itself, never while the loaded window is read again.

Covers 2 captures: Load more at the end of a board column; List loading its next page (Load more).

**Load more at the end of a board column**

Before:

<img src="assets/state-board-load-more-before-desktop.jpg" width="440" alt="Load more at the end of a board column, desktop, before"> <img src="assets/state-board-load-more-before-phone.jpg" width="118" alt="Load more at the end of a board column, phone, before">

After (the last picture is the loaded page):

<img src="assets/state-board-load-more-after-desktop.jpg" width="440" alt="Load more at the end of a board column, desktop, after"> <img src="assets/state-board-load-more-after-phone.jpg" width="118" alt="Load more at the end of a board column, phone, after">

**List loading its next page (Load more)**

Before:

<img src="assets/state-list-load-more-before-desktop.jpg" width="440" alt="List loading its next page (Load more), desktop, before"> <img src="assets/state-list-load-more-before-phone.jpg" width="118" alt="List loading its next page (Load more), phone, before">

After (the last picture is the loaded page):

<img src="assets/state-list-load-more-after-desktop.jpg" width="440" alt="List loading its next page (Load more), desktop, after"> <img src="assets/state-list-load-more-after-phone.jpg" width="118" alt="List loading its next page (Load more), phone, after">

### 25. Header popovers: counts and people

**Was (keep).** One line, or three circles and a line, at the loaded row's height: the popover keeps its size.

Covers 2 captures: Client popover: project counts loading; Who can comment popover: people loading.

**Client popover: project counts loading**

Before:

<img src="assets/state-client-popover-before-desktop.jpg" width="440" alt="Client popover: project counts loading, desktop, before"> <img src="assets/state-client-popover-before-phone.jpg" width="118" alt="Client popover: project counts loading, phone, before">

After (the last picture is the loaded page):

<img src="assets/state-client-popover-after-desktop.jpg" width="440" alt="Client popover: project counts loading, desktop, after"> <img src="assets/state-client-popover-after-phone.jpg" width="118" alt="Client popover: project counts loading, phone, after">

**Who can comment popover: people loading**

Before:

<img src="assets/state-access-popover-before-desktop.jpg" width="440" alt="Who can comment popover: people loading, desktop, before"> <img src="assets/state-access-popover-before-phone.jpg" width="118" alt="Who can comment popover: people loading, phone, before">

After (the last picture is the loaded page):

<img src="assets/state-access-popover-after-desktop.jpg" width="440" alt="Who can comment popover: people loading, desktop, after"> <img src="assets/state-access-popover-after-phone.jpg" width="118" alt="Who can comment popover: people loading, phone, after">

### 26. Usage section (AppPageLoading)

**Was (eliminate).** A second generic page skeleton (a bar and two cards), used once, for one titled card. It pulses while the route-level skeleton is static.

**Done.** `AppPageLoading` is gone. The section's own card stands in (`ProjectUsageLoading`): its real title over six cells of bars, pulsing, with the status "Loading usage".

Before:

<img src="assets/state-settings-usage-before-desktop.jpg" width="440" alt="Project settings: Usage section loading (AppPageLoading), desktop, before"> <img src="assets/state-settings-usage-before-phone.jpg" width="118" alt="Project settings: Usage section loading (AppPageLoading), phone, before">

After (the last picture is the loaded page):

<img src="assets/state-settings-usage-after-desktop.jpg" width="440" alt="Project settings: Usage section loading (AppPageLoading), desktop, after"> <img src="assets/state-settings-usage-after-phone.jpg" width="118" alt="Project settings: Usage section loading (AppPageLoading), phone, after"> <img src="assets/state-settings-usage-after-loaded.jpg" width="440" alt="Project settings: Usage section loading (AppPageLoading), loaded">

### 27. A form saving (pending button)

**Was (keep).** The pattern of every submit button (73 spinners in 47 files): disabled, a spinner before the label.

Before:

<img src="assets/state-form-saving-before-desktop.jpg" width="440" alt="A settings form saving (pending button), desktop, before"> <img src="assets/state-form-saving-before-phone.jpg" width="118" alt="A settings form saving (pending button), phone, before">

After (the last picture is the loaded page):

<img src="assets/state-form-saving-after-desktop.jpg" width="440" alt="A settings form saving (pending button), desktop, after"> <img src="assets/state-form-saving-after-phone.jpg" width="118" alt="A settings form saving (pending button), phone, after">

## Review toolbar

### 28. Toolbar starting

**Was (keep).** Nothing is drawn until the project answers: no pill, no pins. Deliberate, so a site never flashes a toolbar the visitor may not use.

**Not changed.** Deliberate: a site never flashes a toolbar its visitor may not use. The one retry before anything shows was left as it is.

Before:

<img src="assets/toolbar-starting-before-desktop.jpg" width="440" alt="Toolbar starting: the project is read first, desktop, before"> <img src="assets/toolbar-starting-before-phone.jpg" width="118" alt="Toolbar starting: the project is read first, phone, before">

After (the last picture is the loaded page):

<img src="assets/toolbar-starting-after-desktop.jpg" width="440" alt="Toolbar starting: the project is read first, desktop, after"> <img src="assets/toolbar-starting-after-phone.jpg" width="118" alt="Toolbar starting: the project is read first, phone, after"> <img src="assets/toolbar-starting-after-loaded.jpg" width="440" alt="Toolbar starting: the project is read first, loaded">

### 29. Pill while the comments load

**Was (keep).** The pill is complete and usable while the comments load.

Before:

<img src="assets/toolbar-pill-comments-loading-before-desktop.jpg" width="440" alt="Pill while the comments load, desktop, before"> <img src="assets/toolbar-pill-comments-loading-before-phone.jpg" width="118" alt="Pill while the comments load, phone, before">

After (the last picture is the loaded page):

<img src="assets/toolbar-pill-comments-loading-after-desktop.jpg" width="440" alt="Pill while the comments load, desktop, after"> <img src="assets/toolbar-pill-comments-loading-after-phone.jpg" width="118" alt="Pill while the comments load, phone, after">

### 30. Inbox: comments loading

**Was (redesign).** One line of muted text where the cards go. The tabs read Active 0, Done 0, All 0 while the pill's badge already says 30, and the line is not a status region.

**Done.** Three card outlines where the cards go, and one under the list for its next page, with the card's own rows and heights. The tabs, their menus and the location picker show no count until their lists have loaded, never a 0. One hidden status says "Loading comments…". Mark all as read takes its place at once, off until the threads are there.

Before:

<img src="assets/toolbar-inbox-loading-before-desktop.jpg" width="440" alt="Inbox opening: comments loading, desktop, before"> <img src="assets/toolbar-inbox-loading-before-phone.jpg" width="118" alt="Inbox opening: comments loading, phone, before">

After (the last picture is the loaded page):

<img src="assets/toolbar-inbox-loading-after-desktop.jpg" width="440" alt="Inbox opening: comments loading, desktop, after"> <img src="assets/toolbar-inbox-loading-after-phone.jpg" width="118" alt="Inbox opening: comments loading, phone, after"> <img src="assets/toolbar-inbox-loading-after-loaded.jpg" width="440" alt="Inbox opening: comments loading, loaded">

### 31. Thread: screenshot thumbnail

**Was (keep).** A pulsing 96 by 64 box with the screenshot's ratio.

Before:

<img src="assets/toolbar-thread-screenshot-before-desktop.jpg" width="440" alt="Thread: screenshot thumbnail loading, desktop, before"> <img src="assets/toolbar-thread-screenshot-before-phone.jpg" width="118" alt="Thread: screenshot thumbnail loading, phone, before">

After (the last picture is the loaded page):

<img src="assets/toolbar-thread-screenshot-after-desktop.jpg" width="440" alt="Thread: screenshot thumbnail loading, desktop, after"> <img src="assets/toolbar-thread-screenshot-after-phone.jpg" width="118" alt="Thread: screenshot thumbnail loading, phone, after">

### 32. Thread: people to assign

**Was (improve).** A line of text above Unassign; the menu grows when the people arrive. The toolbar writes "..." where the app writes "…".

**Done.** Two person-row outlines between Unassign and Done; the status is a hidden line. Every "..." in the toolbar's six languages is now "…".

Before:

<img src="assets/toolbar-assign-people-before-desktop.jpg" width="440" alt="Thread: people to assign loading, desktop, before"> <img src="assets/toolbar-assign-people-before-phone.jpg" width="118" alt="Thread: people to assign loading, phone, before">

After (the last picture is the loaded page):

<img src="assets/toolbar-assign-people-after-desktop.jpg" width="440" alt="Thread: people to assign loading, desktop, after"> <img src="assets/toolbar-assign-people-after-phone.jpg" width="118" alt="Thread: people to assign loading, phone, after">

### 33. Accessibility panel: checking

**Was (keep).** A spinner and "Checking this page..." in the panel's summary line while the audit script loads and runs.

Before:

<img src="assets/toolbar-accessibility-checking-before-desktop.jpg" width="440" alt="Accessibility panel: checking the page, desktop, before"> <img src="assets/toolbar-accessibility-checking-before-phone.jpg" width="118" alt="Accessibility panel: checking the page, phone, before">

After (the last picture is the loaded page):

<img src="assets/toolbar-accessibility-checking-after-desktop.jpg" width="440" alt="Accessibility panel: checking the page, desktop, after"> <img src="assets/toolbar-accessibility-checking-after-phone.jpg" width="118" alt="Accessibility panel: checking the page, phone, after"> <img src="assets/toolbar-accessibility-checking-after-loaded.jpg" width="440" alt="Accessibility panel: checking the page, loaded">

### 34. SEO and Security panels: checks running

**Was (keep).** A section that waits for a request shows a 14 px spinner and "Checking this page…" in its own box; the rest of the panel is already usable.

Covers 5 captures: SEO panel: checks running; SEO panel, content tab: checks running; SEO panel, sharing tab: checks running; SEO panel, search tab: checks running; Security and compliance panel: checks running.

**SEO panel: checks running**

Before:

<img src="assets/toolbar-seo-checking-before-desktop.jpg" width="440" alt="SEO panel: checks running, desktop, before"> <img src="assets/toolbar-seo-checking-before-phone.jpg" width="118" alt="SEO panel: checks running, phone, before">

After (the last picture is the loaded page):

<img src="assets/toolbar-seo-checking-after-desktop.jpg" width="440" alt="SEO panel: checks running, desktop, after"> <img src="assets/toolbar-seo-checking-after-phone.jpg" width="118" alt="SEO panel: checks running, phone, after"> <img src="assets/toolbar-seo-checking-after-loaded.jpg" width="440" alt="SEO panel: checks running, loaded">

**SEO panel, content tab: checks running**

Before:

<img src="assets/toolbar-seo-content-checking-before-desktop.jpg" width="440" alt="SEO panel, content tab: checks running, desktop, before"> <img src="assets/toolbar-seo-content-checking-before-phone.jpg" width="118" alt="SEO panel, content tab: checks running, phone, before">

After (the last picture is the loaded page):

<img src="assets/toolbar-seo-content-checking-after-desktop.jpg" width="440" alt="SEO panel, content tab: checks running, desktop, after"> <img src="assets/toolbar-seo-content-checking-after-phone.jpg" width="118" alt="SEO panel, content tab: checks running, phone, after">

**SEO panel, sharing tab: checks running**

Before:

<img src="assets/toolbar-seo-sharing-checking-before-desktop.jpg" width="440" alt="SEO panel, sharing tab: checks running, desktop, before"> <img src="assets/toolbar-seo-sharing-checking-before-phone.jpg" width="118" alt="SEO panel, sharing tab: checks running, phone, before">

After (the last picture is the loaded page):

<img src="assets/toolbar-seo-sharing-checking-after-desktop.jpg" width="440" alt="SEO panel, sharing tab: checks running, desktop, after"> <img src="assets/toolbar-seo-sharing-checking-after-phone.jpg" width="118" alt="SEO panel, sharing tab: checks running, phone, after">

**SEO panel, search tab: checks running**

Before:

<img src="assets/toolbar-seo-search-checking-before-desktop.jpg" width="440" alt="SEO panel, search tab: checks running, desktop, before"> <img src="assets/toolbar-seo-search-checking-before-phone.jpg" width="118" alt="SEO panel, search tab: checks running, phone, before">

After (the last picture is the loaded page):

<img src="assets/toolbar-seo-search-checking-after-desktop.jpg" width="440" alt="SEO panel, search tab: checks running, desktop, after"> <img src="assets/toolbar-seo-search-checking-after-phone.jpg" width="118" alt="SEO panel, search tab: checks running, phone, after">

**Security and compliance panel: checks running**

Before:

<img src="assets/toolbar-security-checking-before-desktop.jpg" width="440" alt="Security and compliance panel: checks running, desktop, before"> <img src="assets/toolbar-security-checking-before-phone.jpg" width="118" alt="Security and compliance panel: checks running, phone, before">

After (the last picture is the loaded page):

<img src="assets/toolbar-security-checking-after-desktop.jpg" width="440" alt="Security and compliance panel: checks running, desktop, after"> <img src="assets/toolbar-security-checking-after-phone.jpg" width="118" alt="Security and compliance panel: checks running, phone, after"> <img src="assets/toolbar-security-checking-after-loaded.jpg" width="440" alt="Security and compliance panel: checks running, loaded">

## Browser extension

### 35. Popup: connecting

**Was (improve).** A 120 px popup with a spinner that jumps to about 550 px when the worker answers.

**Done.** The worker answers a new `tab` message from its own state (the sign-in, the active tab, the review that is on), so the popup draws its heading, the site's address, the account controls and the footer at once, and outlines only the project list, the account's email and the hint. Before that first, local answer "Connecting to uier." stands at the height the popup will have.

Before:

<img src="assets/extension-popup-connecting-before-desktop.jpg" width="440" alt="Popup opening: connecting, desktop, before">

After (the last picture is the loaded page):

<img src="assets/extension-popup-connecting-after-desktop.jpg" width="440" alt="Popup opening: connecting, desktop, after"> <img src="assets/extension-popup-connecting-after-loaded.jpg" width="440" alt="Popup opening: connecting, loaded">

After, new capture: Popup: projects loading

<img src="assets/extension-popup-projects-loading-after-desktop.jpg" width="440" alt="Popup: projects loading, desktop, after"> <img src="assets/extension-popup-projects-loading-after-loaded.jpg" width="440" alt="Popup: projects loading, loaded">

### 36. Popup: pending buttons

**Was (keep).** The UI kit's loading button; every other control is disabled.

Covers 2 captures: Popup: starting a review (pending button); Popup: opening sign-in (pending button).

**Popup: starting a review (pending button)**

Before:

<img src="assets/extension-popup-starting-before-desktop.jpg" width="440" alt="Popup: starting a review (pending button), desktop, before">

After (the last picture is the loaded page):

<img src="assets/extension-popup-starting-after-desktop.jpg" width="440" alt="Popup: starting a review (pending button), desktop, after">

**Popup: opening sign-in (pending button)**

Before:

<img src="assets/extension-popup-signing-in-before-desktop.jpg" width="440" alt="Popup: opening sign-in (pending button), desktop, before">

After (the last picture is the loaded page):

<img src="assets/extension-popup-signing-in-after-desktop.jpg" width="440" alt="Popup: opening sign-in (pending button), desktop, after">

### 37. Verification window

**Was (keep).** A purpose-built window: what is happening, one status line with a spinner, and that it closes by itself.

Covers 2 captures: Verification window: starting; Verification window: checking your browser.

**Verification window: starting**

Before:

<img src="assets/extension-helper-starting-before-desktop.jpg" width="440" alt="Verification window: starting, desktop, before">

After (the last picture is the loaded page):

<img src="assets/extension-helper-starting-after-desktop.jpg" width="440" alt="Verification window: starting, desktop, after">

**Verification window: checking your browser**

Before:

<img src="assets/extension-helper-checking-before-desktop.jpg" width="440" alt="Verification window: checking your browser, desktop, before">

After (the last picture is the loaded page):

<img src="assets/extension-helper-checking-after-desktop.jpg" width="440" alt="Verification window: checking your browser, desktop, after">

## Public pages

### 38. Status: live checks

**Was (improve).** Two lines of text with their height reserved. The services' names are fixed.

**Done.** The service rows are in the static shell (`serviceDefinitions`): names and descriptions are real, each row says "Checking…" where its result goes, and the results replace only that state. The section keeps its height.

Before:

<img src="assets/public-status-before-desktop.jpg" width="440" alt="Status: live checks loading, desktop, before">

After (the last picture is the loaded page):

<img src="assets/public-status-after-desktop.jpg" width="440" alt="Status: live checks loading, desktop, after"> <img src="assets/public-status-after-loaded.jpg" width="440" alt="Status: live checks loading, loaded">

### 39. Notification preferences

**Was (keep).** A line of text under the static header, with its height reserved.

Before:

<img src="assets/public-notifications-before-desktop.jpg" width="440" alt="Notification preferences loading, desktop, before">

After (the last picture is the loaded page):

<img src="assets/public-notifications-after-desktop.jpg" width="440" alt="Notification preferences loading, desktop, after"> <img src="assets/public-notifications-after-loaded.jpg" width="440" alt="Notification preferences loading, loaded">

### 40. Integration guide

**Was (keep).** Shows only until the route's params resolve; the header is real.

Before:

<img src="assets/public-integration-before-desktop.jpg" width="440" alt="Integration guide, from the index, desktop, before">

After (the last picture is the loaded page):

<img src="assets/public-integration-after-desktop.jpg" width="440" alt="Integration guide, from the index, desktop, after"> <img src="assets/public-integration-after-loaded.jpg" width="440" alt="Integration guide, from the index, loaded">

### 41. Extension verification bridge

**Was (keep).** Framed by the extension and never seen: unstyled text is enough.

Before:

<img src="assets/public-extension-verification-before-desktop.jpg" width="440" alt="Extension verification bridge, desktop, before">

After (the last picture is the loaded page):

<img src="assets/public-extension-verification-after-desktop.jpg" width="440" alt="Extension verification bridge, desktop, after">

## Seen in the code, not captured

| State | Where | Why not, and what it looks like |
| --- | --- | --- |
| Pending buttons | About 60 forms and actions in the app (73 spinners in 47 files), the popup's and the toolbar's | Same pattern as "A form saving"; one is captured per surface. |
| Installation check running | Settings → Installation, onboarding step 3 | Needs a second window; a spinner in the button, Cancel check and a status line. |
| Welcome, Join a workspace | /app/welcome, /app/join | Redirect unless they apply; their fallback is the sign-in card's. |
| Review link | /app/review/<project> | Redirects to the reviewed site before anything is drawn; its fallback, the status page's outline, is not reachable on a full load. |
| Reply editor | MessageComposer | The placeholder text stands in while the editor's script loads. |
| Recording | MessageRecording, CommentRecording | "Loading recording…" under the Play button; needs a recorded comment. |
| Reviewers for verification | VerificationControl, CommentVerification | "Loading reviewers…" in the select; "Saving verification…" with a spinner. Needs verification turned on. |
| Thread card in an MCP client | src/mcp-app/thread.tsx | "Loading thread…", then "Checking current status…". |
| Toolbar: inbox next page, rewrite suggestions, sending a comment, sign out | CommentsSidebarCommentsList, RewriteSuggestions, CommentComposer, ToolbarOptions | One card outline under the last card for the next page; loading buttons; "Sending…" on the new pin. |
| Integration settings: Load repositories, teams, channels, databases | GitHubSection, LinearSection, SlackSection, NotionSection, AzureDevOpsSection | Pending buttons; need a connected provider. |
| Favicon and avatar fallbacks | ProjectMark, PersonAvatar | The first letter until the image loads; visible in most captures. |
| Dark theme | Every state | All captures are in the light theme. |

## Capturing again

The captures come from `apps/web/e2e/loading-states/` (`playwright.capture.config.ts`), not from the test suites. App routes are held with Next's instant-navigation lock, so the build needs the testing API; everything else holds the request a state waits for. A full load's loaded picture and a denied address's first paint are taken without the lock (a locked document stays at its shell, and a 404 has no prerendered shell to hold). The Usage card (26) loads inside a page that is already there, which no lock holds: it is captured only from a build with a temporary delay in `ProjectUsageSection` (never committed), and otherwise the picture of the last such run is kept.

```sh
UIER_INSTANT_TEST=1 pnpm build
cd apps/web
PORT=4604 pnpm exec playwright test --config=playwright.capture.config.ts
node e2e/loading-states/gallery.mjs   # playwright-report/loading-states/index.html: the current run
node e2e/loading-states/compare.mjs   # compare.html beside it, and this document, against loading-states-before
pnpm -w build                         # an ordinary build again: never test or deploy the testing-API build
```
