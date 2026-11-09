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
  thread and, once read, Mark as unread are in More actions. Then On (what it was left on, with the selector or
  the selected text; `SelectorCode` shows a selector longer than 28 characters as its start and end,
  `#comments>…>dd.m-0>code.ml-2`, one line on a phone, and Show full selector / Shorten selector toggles it; only
  the middle is visually hidden, so assistive tech and a copied selection get the whole selector;
  `e2e/comment-selector.spec.ts` covers it), Page (the review link, "Open on ...", and the environment's name or why the original
  source is unavailable), Priority (`PriorityControl`: the flag and the name; for those who can triage a menu of the
  four, each with its flag, the current one checked) and Assignee (a 20px avatar, empty and dashed while unassigned,
  and the name; a menu for those who can assign; then the AI agent working with the assignee, `AgentControl`: "with",
  the agent's logo, Claude and its model, or Add agent for the assignee), the verification, every message, Reply and the quiet Open in .... The first message's time is followed by
  `CommentDevice`: screen size and browser icons whose popover (hover or click, `hoverPopoverTrigger` for Base
  UI's `openOnHover`, like the project header's access info) lists the reproduction context and copies its
  text; the toolbar still shows one device icon with details under the message. Pending actions show `Spinner`.
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
- `comments/ReplyComposer.tsx` is a lazy inline reply form in List and Board, using shadcn controls
  and pure `@uier/toolbar/drafts` / `mentions` logic only. `replyCommentAction` validates the payload,
  resolves current app authority and forwards trusted request headers to `replyToProjectComment`;
  `commentParticipantsAction` rechecks the thread before returning names/opaque ids without email.
  Replies preserve status and unread state; `CommentUpdates` appends pending messages and action
  revalidation reconciles them. Seven-day drafts are scoped to app origin/deployment, project,
  account and thread. Closing/filtering keeps text; explicit discard, successful send and both
  app sign-out controls clear relevant drafts. Storage failure stays in memory with a notice.
  Never import the toolbar runtime/providers/styles into the app. See `docs/review-workflow.md`.
