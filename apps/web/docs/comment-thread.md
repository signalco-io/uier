# The open thread

- The open thread (`comments/CommentCard.tsx`, one `article` named "Comment by ...") keeps the toolbar's words:
  state, `#number` and the unread dot (the Mark as read button, "Unread. Mark as read") on the first line with
  Copy and More actions at its right, on one line at any width. The state badge is the status menu ("Status:
  Open. Change status") with Open, In progress, Ready to verify and Done, each enabled by the person's permissions
  (`allowedStatuses`): Ready to verify opens the Request verification form (`VerificationControl`, whose submit has
  the same name), Open and In progress from Ready to verify cancel the check and land there, and Done there reads
  Done without verification. Copy is one menu with Copy
  issue (Markdown for an issue or a coding tool; a toast says "Issue copied.", its errors and manual clipboard
  fallback stay in the thread) and Copy link (opens the reviewed page at this comment). Follow thread / Unfollow
  thread and, once read, Mark as unread are in More actions. Under that line, `ThreadTitle` shows the thread's
  [AI title](ai-titles.md) as an `h2` with a sparkles mark ("Title written by AI"); without one there is no heading,
  as the first message shows in full below. Then On (what it was left on, with the selector or
  the selected text; `SelectorCode` shows a selector longer than 28 characters as its start and end,
  `#comments>…>dd.m-0>code.ml-2`, one line on a phone, and Show full selector / Shorten selector toggles it; only
  the middle is visually hidden, so assistive tech and a copied selection get the whole selector;
  `e2e/comment-selector.spec.ts` covers it), Page (the review link, "Open on ...", and the environment's name or why the original
  source is unavailable), Priority (`PriorityControl`: the flag and the name; for those who can triage a menu of the
  four, each with its flag, the current one checked) and Assignee (a 20px avatar, empty and dashed while unassigned,
  and the name; a menu for those who can assign; then the AI agent working with the assignee, `AgentControl`: "with",
  the agent's logo, Claude, its model by name and reasoning level ("Opus 5.5 · xhigh"), or Add agent for the assignee), the verification, every message, Reply and the quiet Open in ....
  A message an AI agent wrote for its author through MCP reads "You via", the agent's logo and "Claude" after the
  author (`MessageAgent`, a ghost button whose hover or click popover says "Claude wrote this for you.", the model,
  reasoning level and connection; [AI agents](assignee-agents.md)). The first message's time is followed by
  `CommentDevice`: screen size and browser icons whose popover (hover or click, `hoverPopoverTrigger` for Base
  UI's `openOnHover`, like the project header's access info) lists the reproduction context and copies its
  text; the toolbar shows the same icons and details. The browser icon is the browser's own mark and the
  popover puts a mark beside the operating system too (`DeviceMark.tsx`: `BrowserMark`, `OsMark`). Pending actions show `Spinner`.
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
  `@uier/toolbar/devices`): `browserKind` and `osKind` read the stored names ("Microsoft Edge (156)", "macOS") and
  choose a one-colour mark in the text colour, like `AgentMark`, decorative beside the written name. Browsers:
  Chrome (also Chromium and headless Chrome), Edge, Safari, Firefox, Samsung Internet, Opera (and Opera GX), Brave
  and Vivaldi, else a globe. Systems: Windows, macOS, iOS and iPadOS (the Apple mark), Android, Linux and Chrome OS,
  else a window. The names come only from low-entropy client hints (`getDeviceInfo`), which Chromium browsers send
  with a platform of Windows, macOS, Linux, Android, Chrome OS, Chromium OS, Fuchsia or Unknown; Safari and Firefox
  send none, so their comments say Unknown browser with the generic marks. Collecting more (user agent parsing) is
  a privacy decision (`docs/api.md`, the privacy policy), not a mark change. Sources are in `devices.ts` (Simple Icons CC0, Bootstrap Icons MIT, Tabler
  and Lucide outlines); never redraw a vendor's logo. `e2e/device-marks.api.spec.ts` covers the mapping and
  `e2e/project-review.spec.ts` (the reproduction details test) the marks in the toolbar and app popovers.
- `comments/ReplyComposer.tsx` is a lazy inline reply form in List and Board, using shadcn controls
  and pure `@uier/toolbar/drafts` / `mentions` logic only. `replyCommentAction` validates the payload,
  resolves current app authority and forwards trusted request headers to `replyToProjectComment`;
  `commentParticipantsAction` rechecks the thread before returning names/opaque ids without email.
  Replies preserve status and unread state; `CommentUpdates` appends pending messages and action
  revalidation reconciles them. Seven-day drafts are scoped to app origin/deployment, project,
  account and thread. Closing/filtering keeps text; explicit discard, successful send and both
  app sign-out controls clear relevant drafts. Storage failure stays in memory with a notice.
  Never import the toolbar runtime/providers/styles into the app. See `docs/review-workflow.md`.
