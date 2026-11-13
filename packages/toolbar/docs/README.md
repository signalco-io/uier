# packages/toolbar notes

One note per feature area of the toolbar. Rules for every change are in [the toolbar guide](../AGENTS.md).
Read the note for the area you change, and update it in the same pull request. A new area gets its own note and a line here.

- [Anchor recovery](anchor-recovery.md): re-finding a comment's anchor after the page changed, and reattaching it.
- [Review brief](review-brief.md): showing the project brief in the toolbar.
- [Feedback export](feedback-export.md): Copy issue and the shared feedback context packet.
- [Optimistic status changes](optimistic-status.md): optimistic status changes and rollback.
- [Packaged extension adapter](extension-adapter.md): the packaged browser extension adapter.
- [Priority and matching](priority-and-matching.md): priority vocabulary and literal word matching.
- [Fix verification](fix-verification.md): the verification controls the toolbar shares with the app.
- [Message Markdown](message-markdown.md): the Markdown subset thread messages show, its parser and renderers, and the swatch before a colour value.
- [Message editor](message-editor.md): the rich text editor every composer uses (toolbar and app), Markdown typed as you write, its keys, pasting, saving as Markdown.
- [Message reactions](reactions.md): emoji reactions under each message, Add reaction and its quick set.
- [Reviewing uier's own toolbar](toolbar-review.md): commenting on the toolbar's parts on uier's own pages, popovers held open, openers.
- [Keyboard](keyboard.md): the shortcuts, the switch that turns them off, and the composites with one tab stop.
- [Realtime subscription](realtime.md): socket reconciliation reasons shared by the toolbar and app.
- [Canvas mode](canvas-mode.md): drawing on the page (pen, marker, shapes, arrows, notes, blur), one comment with the drawing, on the page and in its screenshot.
- [New comment and feedback popovers](composer-popovers.md): where a pin and its popover go at the window's edges, the people beside a pin, the hover preview, the form (and a rewrite's), drafts (several on a page, listed in the inbox), posting into the thread in one popover, expanding to a modal.
- [Page-check panels](page-checks.md): the page's checks from the pill, their shared layout (summary, sections, compact rows), axe-core and the on-demand sections in a lazy pinned asset, Core Web Vitals, and one-click comments for issues.
  - [Target size, To review, Comment on all and Not an issue](page-checks-report.md): WCAG 2.2's target size, what axe-core could not decide, one comment for a rule's elements, and findings dismissed in this browser.
  - [Keyboard and screen reader](page-checks-keyboard.md): the tab order on the page, the focus indicator check, and the outline of landmarks, headings and controls.
  - [Alt text, zoom and text spacing, motion](page-checks-content.md): the alt text review, reflow at this width, the text spacing mode, and animations and media that move on their own.
  - [Security and compliance](page-checks-security.md): page evidence, optional anonymous response-header checks, unknowns and privacy limits.
  - [Consent inventory and observation](page-checks-consent.md): names-only storage inventory, known consent-platform markers and a bounded observation before a consent choice.
  - [Sharing and structured data](page-checks-seo-head.md): Open Graph and X card tags with their previews, and the JSON-LD checks with their sources.
  - [More Page, Links and Images checks](page-checks-seo-page.md): viewport, language and hreflang, generic link text, Check links, and image weight.
  - [Crawlers](page-checks-crawler.md): the page's response, the served HTML against the rendered page, robots.txt for search and AI crawlers, the sitemap and llms.txt.
  - [AI search](page-checks-ai-search.md): what an AI reads of the page, citable facts, and AI suggestions.
  - [A finding checked again in its thread](page-checks-verify.md): Check again on a comment posted from a page check.
  - [Page checks across the site](page-checks-site.md): the summary a member's toolbar sends for the app's Page checks view.

- [Account switching](account-switching.md): foreground sign-in follows the app account while retaining blocked-cookie fallback.
- [Toolbar languages](localization.md): the six languages, which one shows, the catalogs and language assets, and how to write strings.
- [The pill, Options and notices](pill-and-options.md): the pill's buttons, collapsing, the profile and options popovers, moving the pill and docking panels, notices and error messages by the pill.
- [Point mode, areas and selected text](point-mode.md): picking an element or dragging an area on the page, area outlines, and the toolbar for selected text.
- [Pins and threads](comment-thread.md): the pin, the thread's layout and header, Copy, Thread options, a message's options, and icon buttons' tooltips.
- [Screenshots and images](screenshots.md): the automatic capture, Omit screenshot and Attach image in the form, and uploading, pasting and redacting saved images.
- [Device details](device-details.md): the browser, OS and screen a comment was left from, and their details popover.
- [Inbox](inbox.md): the inbox's title row, filters, location picker, status tabs, drafts, and its virtualized, paged list.
- [Project mode](project-mode.md): the project gate, silent member sign-in, and the installation check.
- [Page identity](page-state.md): a page's canonical identity, its source path, and following client-side navigation.
