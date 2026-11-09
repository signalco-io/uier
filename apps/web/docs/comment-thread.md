# The open thread

- `ThreadActivity` adds a compact, initially closed Activity section below Reply in the app.
  The toolbar's `CommentActivity` fits the same section into pin popovers and inbox threads.
  Each shows authorized entries oldest first, with relative times and a bounded scrolling list.
  It adds no reads or acknowledgements. See [thread history](read-state-and-activity.md#thread-history)
  for retention, write paths and private-period filtering. Guests receive no history section.

- The open thread (`comments/CommentCard.tsx`, one `article` named "Comment by ...") keeps the toolbar's words:
  state, `#number`, the unread dot (the Mark as read button, "Unread. Mark as read") and, on a private thread, the
  Private badge (focusable; its tooltip says only workspace admins and the author see it, `canSeeComment`) on the first line with
  Copy and More actions at its right, on one line at any width. The state badge is the status menu ("Status:
  Open. Change status") with Open, In progress, Ready to verify and Done, each enabled by the person's permissions
  (`allowedStatuses`): Ready to verify opens the Request verification form (`VerificationControl`, whose submit has
  the same name), Open and In progress from Ready to verify cancel the check and land there, and Done there reads
  Done without verification. Copy is one menu with Copy
  issue (Markdown for an issue or a coding tool; a toast says "Issue copied.", its errors and manual clipboard
  fallback stay in the thread) and Copy link (opens the reviewed page at this comment). Follow thread / Unfollow
  thread and, once read, Mark as unread are in More actions. Under that line, right beneath it (no gap, never over the controls), `ThreadTitle` shows the thread's
  title as an `h2`: one a member gave it, or its [AI title](ai-titles.md) with a sparkles mark ("Title written by
  AI"). For those who can triage (`permissions.title`) the title is a button: a click or focus turns it into the
  Thread title field in place (Enter or leaving it saves, Escape cancels and gives focus back; an empty title
  brings the AI title back), and a thread without a title shows a quiet Add a title. Otherwise, without a title
  there is no heading, as the first message shows in full below. Then the details, from the most abstract to the most
  detailed: Page, On, Assignees, Priority, then Pull requests. On (what it was left on, with the selector or
  the selected text; `SelectorCode` shows a selector longer than 28 characters as its start and end,
  `#comments>…>dd.m-0>code.ml-2`, one line on a phone, and Show full selector / Shorten selector toggles it; only
  the middle is visually hidden, so assistive tech and a copied selection get the whole selector;
  `e2e/comment-selector.spec.ts` covers it), Page (the review link, "Open on ...", and the environment's name or why the original
  source is unavailable), Priority (`PriorityControl`: the flag and the name; for those who can triage a menu of the
  four, each with its flag, the current one checked) and Assignee (a 20px avatar, empty and dashed while unassigned,
  and the name, together one menu button for those who can assign; then the AI agent working with the assignee, `AgentControl`: "with",
  the agent's logo, Claude, its model by name and reasoning level ("Opus 5.5 · xhigh"), or Add agent for the assignee), the verification, every message, Reply (its icon in line with the message text) and the quiet Open in ....
  A message an AI agent wrote for its author through MCP reads "You via", the agent's logo and "Claude" after the
  author (`MessageAgent`, a ghost button whose hover or click popover says "Claude wrote this for you.", the model,
  reasoning level and connection; [AI agents](assignee-agents.md)). The first message's time is followed by
  `CommentDevice`: screen size and browser icons whose popover (hover or click, `hoverPopoverTrigger` for Base
  UI's `openOnHover`, like the project header's access info) lists the reproduction context and copies its
  text; the toolbar shows the same icons and details. The browser icon is the browser's own mark and the
  popover puts a mark beside the operating system too (`DeviceMark.tsx`: `BrowserMark`, `OsMark`). Pending actions show `Spinner`.
- Pull requests (`comments/ThreadPullRequests.tsx`) add a Pull requests row to the details when a current
  message, reply or manual attachment contains a GitHub.com PR, GitLab.com merge request or Azure DevOps Services PR URL.
  Project triagers also see the URL entry field when there are no links.
  Markdown destinations, autolinks and bare links count; duplicate URLs, query strings and fragments collapse
  to one canonical link. Edited text is re-read and deleted messages contribute nothing. The row appears
  immediately, including for a pending reply; only saved text can trigger a server read. Open, Merged,
  Closed and Draft appear beside the link when known as `PullRequestStateBadge` (a dot coloured like GitHub's
  states: green, violet, red, muted grey; BRAND.md "Pull request state"), otherwise it stays a plain link. Nothing changes
  the thread's uier status. State reads happen only while the detail is on screen in a visible tab, on
  opening and every five minutes; the server cache and provider budgets are shared across instances.
  See [integration state reads](integrations.md#linked-pull-request-state) for authority, permissions and
  limits. `e2e/pull-requests.spec.ts` covers replies, details, list/board marks, both themes and accessibility
  on desktop and mobile; `pull-requests.api.spec.ts` covers recognition, state mapping and read isolation.
- Message text is `comments/MessageMarkdown.tsx`: the Markdown subset of `@uier/toolbar/markdown` as React
  elements, the same tree as the toolbar's `MessageMarkdown` (change both together), "(edited)" ending its last
  paragraph. Mentions come as `displayMentions` / a reply's `mentions`, UTF-16 ranges over the text as shown
  (`projectComments.ts` `mentionText`), so Markdown never touches a name; a pending reply passes its composer
  ranges. Headings are bold paragraphs, links open in a new tab, code is Geist Mono on `bg-muted` with a hairline
  border (in dark mode a popover is the muted colour). What is supported and why: [Markdown in
  messages](../../../docs/review-workflow.md#markdown-in-messages). `e2e/message-markdown.api.spec.ts` covers the
  parser and both renderers, `e2e/message-markdown.spec.ts` the app and toolbar threads on desktop and mobile.
- The open thread reads itself (`comments/useReadWhenShown.ts`, the toolbar's rule): once its `article` has been
  on screen for 800 ms in a visible, focused window it is marked read at its shown sequence through
  `markCommentReadAction`. That covers a click, a `?comment=` link (My work, copied links, Back/Forward), the
  arrow keys and the board's sheet; the arrow keys pass threads faster, so only the one they stop on is read.
  The first thread shown beside the list is read too (it is displayed in full); where it is hidden (a phone,
  until a row is opened) the IntersectionObserver never sees it, so it stays unread. Only an unread thread
  writes. The dot and counts change at once through `CommentUpdates`; a failed write rolls back without a
  toast and is not retried for that sequence while the thread stays open. Mark as unread turns it off until
  the thread is opened again. Only unread keeps the open thread and its row while it is open (`applyFilters`'
  `openId`), so reading the last unread thread does not empty the list (or close the board's sheet); it leaves
  once another is opened. Reading the first shown thread there opens it (`replace`), so it stays and the next
  one is not shown and read in its place.
  `e2e/comment-auto-read.spec.ts` covers it. A test about something else that holds, fails or counts the
  page's server actions, or checks the unread dot, calls `inBackground(page)` (`e2e/support/app.ts`) first, so a
  slow step cannot add a read write.
- Device marks (`comments/DeviceMark.tsx`, the toolbar's `components/info/DeviceMark.tsx`, both over the pure
  `@uier/toolbar/devices`): `browserKind` and `osKind` read the stored names ("Safari (18.1)", "macOS 15.1", and on
  older comments the client hint brand and platform, "Microsoft Edge (156)", "macOS") and choose a one-colour mark in
  the text colour, like `AgentMark`, decorative beside the written name. Browsers: Chrome (also Chromium and headless
  Chrome), Edge, Safari, Firefox, Samsung Internet, Opera (and Opera GX, Opera Mini), Brave, Vivaldi, DuckDuckGo and
  the Facebook and Instagram in-app browsers, else a globe. Systems: Windows, macOS, iOS and iPadOS (the Apple mark),
  Android, Linux, Chrome OS, Ubuntu, Fedora, HarmonyOS, FreeBSD and KaiOS, else a window (OpenBSD, NetBSD, Tizen,
  webOS and Fuchsia are named but have no mark of their own). Sources are in `devices.ts` (Simple Icons CC0, Bootstrap
  Icons MIT, Tabler and Lucide outlines); never redraw a vendor's logo.
- Device details (`getDeviceInfo` in the toolbar, `describeDevice` and `parseUserAgent` in `@uier/toolbar/devices`):
  the toolbar parses the user-agent string in the reviewer's browser when Chromium's client hints are missing
  (Safari, Firefox, every iOS browser) and sends only the names, never the string. Client hints name Chromium
  browsers (only they tell Brave from Chrome) unless the string names an in-app browser. A version is shown only
  when it is real: macOS stays at 10_15_7, Windows 10 and 11 both say NT 10.0, Chrome's reduced Android string says
  "Android 10; K" and Safari 26 keeps iOS at 18_6, so those show no version; on iOS Safari's own version is the
  system's, and an iPad asking for the desktop site (a Mac string with touch points) is iPadOS. Chromium's
  high-entropy hints are asked once, for `platformVersion` (Windows 11 is 13 and later) and a phone's `model`, and
  the post waits for them at most a second (`completeDeviceInfo`). The toolbar also records the primary input
  (`pointer: coarse` is touch), the colour scheme, reduced motion and the page's `<html lang>` (language, script and
  region only). The API keeps bounded names and drops settings it does not know (`deviceSchema`); the popovers list
  model, input, colour scheme, reduced motion and page language under the browser row when recorded
  (`deviceSettings`; in the app as two-column tiles styled like the screen and browser rows, each with a lucide icon:
  phone, pointer or hand, sun or moon, accessibility, languages, and shorter words so none truncate: Mouse, Theme, Motion
  Reduced or Standard, Language; the copied details and packets keep the full ones), older comments show what they have. `e2e/user-agent.api.spec.ts` covers the parser with real
  strings, `e2e/device-details.api.spec.ts` validation, storage and who sees what, `e2e/device-marks.api.spec.ts` the
  mapping and `e2e/project-review.spec.ts` (the reproduction details tests) the toolbar and app popovers.
- Under the messages, Reply is a quiet ghost button with the reply icon, aligned with the message text (R opens it).
  `comments/ReplyComposer.tsx` is the lazy inline reply form it opens in List and Board, using shadcn controls;
  Post reply is a ghost button too, as Enter sends (Shift+Enter for a new line), like the toolbar's plain send button.
  It uses pure `@uier/toolbar/drafts` / `mentions` logic only. `replyCommentAction` validates the payload,
  resolves current app authority and forwards trusted request headers to `replyToProjectComment`;
  `commentParticipantsAction` rechecks the thread before returning names/opaque ids without email.
  Replies preserve status and unread state; `CommentUpdates` appends pending messages and action
  revalidation reconciles them. Seven-day drafts are scoped to app origin/deployment, project,
  account and thread. Closing/filtering keeps text; explicit discard, successful send and both
  app sign-out controls clear relevant drafts. Storage failure stays in memory with a notice.
  The reply browser check waits for the saved-reply announcement before its light/dark axe scans,
  so it audits the settled document after action revalidation rather than the optimistic message.
  Never import the toolbar runtime/providers/styles into the app. See `docs/review-workflow.md`.
- A reply's More actions menu (`w-auto min-w-48`, so its items stay on one line) starts with Edit for a message the
  member may edit (`canEditItem`, as the toolbar allows: its author or an admin; the view carries its saved text
  and mentions as `editable` only then). Edit turns the message into `MessageEditor` in place: the saved text with
  Cancel and Save (Enter saves, Shift+Enter adds a line, Escape cancels), and the menu takes the focus back when it
  closes. `MentionTextarea` is the field with `@` mentions that the reply form uses too; mentions move with the text.
  After a chosen mention the caret is placed in a layout effect, in the same commit as the new value, so typing straight
  on continues after the name; a deferred move (`requestAnimationFrame`) once let later keys land before the name.
  `editCommentReplyAction` calls the review API's edit (`editProjectCommentItem`: `expectedText`, mentions, the
  edited label); the new text shows at once through `CommentUpdates`. When the message changed in the meantime the
  edit is refused, the field keeps the tried text and says why. `e2e/app-message-edit.spec.ts` covers it. The first
  message is edited from the thread's More actions (Edit comment dialog).

Project triagers can paste a supported pull request URL in the open thread properties. The row shows a quiet
Link a pull request ghost control (plus icon, muted text, like Assignees' Unassigned); choosing it reveals the
Pull request URL field with focus in it, Escape closes it and returns focus, and a saved link closes it. Manually linked PRs persist separately from messages, deduplicate with message links and appear in the row/card hover or tap card with the same provider icons and state badges as detected links. Once a state is known, the link's icon and name take the
badge's colour (Open green, Merged violet, Closed red, Draft muted; `data-pull-request-color`); a closed one's name stays
in ink, as the red is under 4.5:1 for text on dark. Only the member who linked one can remove that manual link; message detection remains independent.
