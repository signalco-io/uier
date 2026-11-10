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
- [Message Markdown](message-markdown.md): the Markdown subset thread messages show, its parser and renderers.
- [Reviewing uier's own toolbar](toolbar-review.md): commenting on the toolbar's parts on uier's own pages, popovers held open, openers.
- [Keyboard](keyboard.md): the shortcuts, the switch that turns them off, and the composites with one tab stop.
- [Realtime subscription](realtime.md): socket reconciliation reasons shared by the toolbar and app.
- [New comment and feedback popovers](composer-popovers.md): where a pin and its popover go at the window's edges, the form (and a rewrite's), posting into the thread in one popover, expanding to a modal.
- [Accessibility and SEO panels](page-checks.md): the page's checks from the pill, their shared layout (summary, sections, compact rows), axe-core and the on-demand sections in a lazy pinned asset, Core Web Vitals, and one-click comments for issues.
  - [Keyboard and screen reader](page-checks-keyboard.md): the tab order on the page, the focus indicator check, and the outline of landmarks, headings and controls.
  - [Alt text, zoom and text spacing, motion](page-checks-content.md): the alt text review, reflow at this width, the text spacing mode, and animations and media that move on their own.
  - [Sharing and structured data](page-checks-seo-head.md): Open Graph and X card tags with their previews, and the JSON-LD checks with their sources.
  - [More Page, Links and Images checks](page-checks-seo-page.md): viewport, language and hreflang, generic link text, Check links, and image weight.
  - [Crawlers](page-checks-crawler.md): the page's response, the served HTML against the rendered page, robots.txt for search and AI crawlers, the sitemap and llms.txt.
  - [AI search](page-checks-ai-search.md): what an AI reads of the page, citable facts, and AI suggestions.
  - [A finding checked again in its thread](page-checks-verify.md): Check again on a comment posted from a page check.
  - [Page checks across the site](page-checks-site.md): the summary a member's toolbar sends for the app's Page checks view.

- [Account switching](account-switching.md): foreground sign-in follows the app account while retaining blocked-cookie fallback.
