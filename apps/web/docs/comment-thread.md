# The open thread

- `ThreadActivity` adds a compact, initially closed Activity section as the open thread's card footer in the app
  (the kit's `CardFooter` under a divider: the muted band down to the card's edge, after Reply and the Open in ... links).
  The toolbar's `CommentActivity` fits the same section into pin popovers and inbox threads.
  Each shows authorized entries oldest first, with relative times and a bounded scrolling list.
  It adds no reads or acknowledgements. See [thread history](read-state-and-activity.md#thread-history)
  for retention, write paths and private-period filtering. Guests receive no history section.

- The toolbar's thread (`CommentThread.tsx`, in pin popovers and inbox cards) keeps its sections 8 px apart: the
  status line, the messages (16 px between messages) and what follows them, inside 12 px of padding above and
  below (uier #215). A part that shows nothing renders nothing, so it adds no gap: a quiet anchor's
  `data-uier-anchor-state` status is the absolutely positioned `sr-only` span alone (`CommentAnchorDetails.tsx`).

- The open thread (`comments/CommentCard.tsx`, one `article` named "Comment by ...") keeps the toolbar's words:
  state, `#number`, the unread dot (the Mark as read button, "Unread. Mark as read") and, on a private thread, the
  Private badge (a ghost badge with no background, muted lock and text; focusable; its tooltip says only workspace admins and the author see it, `canSeeComment`) on the first line with
  Copy and More actions at its right, on one line at any width. The state badge is the status menu ("Status:
  Open. Change status"; on a touch screen a 32 px pill with roomier sides whose hit area reaches 44 px, uier #280) with Open, In progress, Ready to verify and Done, each enabled by the person's permissions
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
  detailed: Page, On, Assignees, Priority, then Pull requests. Every value still unset or at its default (Unassigned,
  the default Normal priority, Link a pull request) has one "not set" look (`unsetValue.ts`, `data-unset`): muted text
  with its icon in the same colour, ink on hover for a control; set values are ink. `e2e/thread-details.spec.ts` checks it. On (what it was left on, with the selector or
  the selected text; `SelectorCode` shows a selector longer than 28 characters as its start and end,
  `#comments>…>dd.m-0>code.ml-2`, one line on a phone, and Show full selector / Shorten selector toggles it; only
  the middle is visually hidden, so assistive tech and a copied selection get the whole selector;
  `e2e/comment-selector.spec.ts` covers it), Page (the environment's name or why the original source is unavailable, then the review link,
  "Open on ..."), Priority (`PriorityControl`: the flag and the name; for those who can triage a menu of the
  four, each with its flag, the current one checked) and Assignee (a 20px avatar, or a person icon while unassigned,
  and the name, together one menu button for those who can assign, with a chevron only while unassigned; then the AI agent working with the assignee, `AgentControl`: "with",
  the agent's logo, Claude, its model by name and reasoning level ("Opus 5.5 · xhigh"), or Add agent for the assignee; an attached agent's button has no chevron; clicking it shows the agent's details as on the
assignee card, with Open in T3 Code or another desktop session link, at the top of the assignee's menu or in a hover/click popover for others), the verification, every message, Reply (its icon in line with the message text) and the quiet Open in ....
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
  mapping and `e2e/project-review.spec.ts` (the reproduction details tests) the toolbar and app popovers,
  including the app's compact tile words and identical copied details from both surfaces.
  `e2e/editing.spec.ts` checks that missing client hints fall back to parsed browser and OS names,
  without sending the raw user-agent string or exposing reproduction details on public feedback.
- Every place the app takes a message uses one composer, `comments/MessageComposer.tsx`, laid out as the toolbar's
  `CommentComposer`: one box (shadcn `InputGroup`) with the text and, inside it under the text, the character count
  (from 900 of 1000; no visible "@ to mention" hint, uier #287) on the left and the buttons on the right (the surface's cancel, Discard while
  there is text, then the send icon button with its tooltip or a Save text button); under the box the mention list,
  the error and notices. No visible keyboard hint ([uier #175](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_B5Zp66h_oPH67ZI1HAbRV)):
  the keyboard shortcuts dialog lists Enter, Shift+Enter and Esc under "The open thread", and the field is
  described to screen readers as "Type @ to mention someone with access. Enter to send. Shift+Enter for a new line."
  (save and Escape for editors). It takes the focus with the caret at the end. Surfaces switch features off through props
  (`mentionsIn`, `onCancel`/`escapeCancels`, `onEscapeEmpty`, `onDiscard`); don't add another reply box or a variant layout. The
  Request verification form (`VerificationControl`) is a form of labelled fields, not a message, and stays one.
- Each message (`Message` in `CommentCard.tsx`) is a two-column grid: the 24px avatar is centred on its header row
  (name, via, time, device and the actions, 44px tall on touch screens), the text under the header (uier #281).
- Reactions (`comments/MessageReactions.tsx`, kept apart from `Message`): Add reaction in each message's header actions
  (before a reply's More actions) and the reaction pills under the message, after its image. See [Message reactions](reactions.md).
- Under the messages, Reply is a quiet ghost button with the reply icon, aligned with the message text (R opens it).
  `comments/ReplyComposer.tsx` is the lazy inline reply form it opens in List, Board and the inbox: the shared composer
  with mentions, Discard and the Post reply send button (Enter sends, Shift+Enter adds a line). It has no close button
  (uier #288): Escape in the empty field closes it and gives the focus back to Reply (`onEscapeEmpty`); with text,
  Escape is left to the thread and the draft is kept. It shares the toolbar's draft/mention logic and browser-only attachment reader. `replyCommentAction` validates the payload,
  resolves current app authority and forwards trusted request headers to `replyToProjectComment`;
  `commentParticipantsAction` rechecks the thread before returning names/opaque ids without email.
  Replies preserve status and unread state; `CommentUpdates` appends pending messages and action
  revalidation reconciles them. Seven-day drafts are scoped to app origin/deployment, project,
  account and thread, without a build id, so a deployment reload uses the same draft. Closing/filtering
  keeps text; explicit discard, successful send and both app sign-out controls clear relevant drafts.
  Storage failure stays in memory with a notice.
  Reply's Attach image and image paste use the same memory-only browser reader (`@uier/toolbar/attachments`)
  as new toolbar comments: one PNG, JPEG or WebP up to 512 KB and 4096 px per side. The file name replaces
  the attach button, with Remove; reading holds Enter/send, Discard clears the image, and failed sends restore
  it unless a newer image was attached. Image bytes never enter draft or idempotency storage. Reply images
  use the same thumbnail/expanded dialog (`MessageImage`) as the first message, each through its authorized
  thread/reply image route. The thumbnail button keeps the name "Screenshot of the commented part of the page"
  (the toolbar's `screenshot.alt`); the image inside says only what it shows, "Commented part of the page"
  (`screenshot.imageAlt`), because screen readers already announce an image and the alt-text check flags "Screenshot of".
  `e2e/reply-images.spec.ts` covers picker, paste, retry, both surfaces, reload,
  light/dark accessibility and touch.
  The reply browser check waits for the saved-reply announcement before its light/dark axe scans,
  so it audits the settled document after action revalidation rather than the optimistic message.
  Never import the toolbar runtime/providers/styles into the app. See `docs/review-workflow.md`.
- A reply's More actions menu (`w-auto min-w-48`, so its items stay on one line) starts with Edit for a message the
  member may edit (`canEditItem`, as the toolbar allows: its author or an admin; the view carries its saved text
  and mentions as `editable` only then). Edit turns the message into `MessageEditor` in place: the saved text with
  Cancel and Save in the shared composer (Enter saves, Shift+Enter adds a line, Escape cancels), and the menu takes the
  focus back when it closes. `MessageComposer`'s field is the toolbar's rich [message editor](../../../packages/toolbar/docs/message-editor.md)
  (`@uier/toolbar/editor`, loaded with `React.lazy` and preloaded by `CommentCard` when the thread can be replied to or
  edited; an `aria-hidden` placeholder holds its place until then): Markdown typed in it formats as it is written and
  what is saved is Markdown. `useMentionEditor` (`MentionEditor.tsx`) gives it its `@` mentions, Enter and Escape;
  each mention is one node that moves with the text. A chosen mention and a space go in the `@` query's place with
  the caret after them in one change, so typing straight on continues after the name. `fieldRef` is the editor's
  handle, for R to focus the reply box.
  App edits use that same draft store/scope (`replyDrafts.ts`), with `edit` for the first message and
  `edit-reply:<itemId>` for each reply. `MessageEditor` writes text and mentions synchronously, including empty
  text; `CommentCard` restores open editors after hydration when the current view still allows editing.
  Navigation, thread remounts, RSC refreshes and document reloads retain the draft and the reply's original
  `expectedText`. Cancel/Escape explicitly discards the edit; successful saves clear it only after the action
  succeeds. Saves share the draft store's pending lock across remounts and retain newer text typed while a
  response is pending. Failed saves keep the draft across reloads; sign-out clears edits with replies. Captures
  and image attachments stay in memory. `e2e/app-composer-drafts.spec.ts` exercises remounts, reloads, empty edits,
  cancellation/saving and the real Next.js deployment-mismatch navigation fallback with the app reply and the
  app's own toolbar feedback open. `app-message-edit.spec.ts` checks restored mentions and stale-edit protection.
  `editCommentReplyAction` calls the review API's edit (`editProjectCommentItem`: `expectedText`, mentions, the
  edited label); the new text shows at once through `CommentUpdates`. When the message changed in the meantime the
  edit is refused, the field keeps the tried text and says why. `e2e/app-message-edit.spec.ts` covers it. The first
  message is edited in place the same way from the thread's More actions (Edit, "Edit comment"), without mentions
  (`editCommentAction` keeps the saved ones where they are); the editor stays open while it saves, keeps the text
  and says why when the save fails, and gives the focus back to the thread's More actions when it closes (the menu
  leaves the focus in the editor when Edit opens it). `e2e/project-review.spec.ts` covers it.

Project triagers can paste a supported pull request URL in the open thread properties. The row shows a quiet
Link a pull request ghost control (plus icon, the shared "not set" look), in a row one control tall so it
is centred on the Pull requests label like every other row's control; choosing it reveals the
Pull request URL field with focus in it, Escape closes it and returns focus, and a saved link closes it. Manually linked PRs persist separately from messages, deduplicate with message links and appear in the row/card hover or tap card with the same provider icons and state badges as detected links. Once a state is known, the link's icon and name take the
badge's colour (Open green, Merged violet, Closed red, Draft muted; `data-pull-request-color`); a closed one's name stays
in ink, as the red is under 4.5:1 for text on dark. Only the member who linked one can remove that manual link, with the small x icon button beside it (named and
tooltipped "Remove link to GitHub acme/site #2"); message detection remains independent.


Archive comment / Restore comment are in More actions (toolbar: Thread options) for people with the
thread's existing resolve permission. Archive remains independent of the status menu: the thread keeps
its workflow badge and gains a neutral Archived label. Restore retains the original workflow, pending
verification and completion time. Archive/restore records member-visible Activity entries and advances
thread activity without acknowledging read cursors. The change reconciles through the existing app
snapshot and toolbar cache refresh; failures restore the previous view. See [Archive](comments-inbox.md#archive).
