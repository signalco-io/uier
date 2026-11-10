# SEO panel: AI search

The last section of the SEO panel's Search tab ([the panels](page-checks.md), "Sections"): whether AI assistants and AI search
can read and attribute the page. The field is young and little about it is verified, so the section states
facts about the page and never says what an AI does with them.

- **Logic**: `src/checks/lazy/aiSearch.ts` (`readPage`), in the audit asset. **View**:
  `components/checks/sections/AiSearchSection.tsx`. One `panel` section (`aiSearch`): it runs when the SEO
  panel opens and on Check again, one synchronous read of the document. Check ids are `ai-*` (type `seo`).
- The view splits the report into two cards: **AI search** (what an AI reads, the Markdown, AI suggestions)
  and **Citable facts**. Its note says "As rendered in this browser".

## What an AI reads

- **The main content**: `main` or `[role=main]` (the first rendered one), else the largest `article` (by text
  length), else the body without its chrome (`nav`, `aside`, `form`, roles navigation, banner, contentinfo,
  complementary, search and form, and a `header` or `footer` outside an article, section or main). The
  **Main content** row says which; without a main landmark it is worth a look, with a page issue
  (`ai-content`).
- **Markdown** of that root, read from the rendered document: headings, paragraphs, lists (nested, `ol`
  numbering and `start`), tables (the first row is the header, `colspan` as empty cells, `|` escaped),
  block quotes, `pre` as fenced code (with its `language-*`), inline code, emphasis, links as
  `[text](address)` and images as `![alt](address)`, both through `writtenAddress` (no query). An image
  with `alt=""` is decoration and writes nothing. `display: contents` is followed into its children. Left
  out: what is not rendered now (`checkVisibility` with `visibility`), scripts, styles, templates, form
  fields, SVG, media, the toolbar (its host, inline thread slots) and shadow roots (only the light DOM is
  read). A closed `details` writes its summary only.
- **Bounds**: 40,000 characters of Markdown and 20,000 elements; the walk stops at either, and the Text row
  says it was cut.
- **Text** row: words (`Intl.Segmenter`, word-like segments, link addresses left out), headings, and
  "about N tokens" (an estimate: four characters a token, one per Han, kana or Hangul character, two
  significant digits). Under 100 words it is a note ("Very little text in the main content."). Its
  reason says what it is: "From the page as rendered in this browser." What is missing without
  JavaScript is the Crawlers section's, not this one's.
- **Not in the text** row, as counts: images without alt text (not decoration: `role` presentation/none,
  inside `aria-hidden`), frames (`iframe`, `frame`, `object`, `embed`), canvases, and hidden blocks of text
  (an element not rendered now with at least 20 characters of text, such as a closed tab or `hidden`; a
  closed `details` counts once). A note when there are any; nothing else.
- **The preview**: **Markdown** (a disclosure button, `aria-expanded`) opens a read-only, monospace,
  scrollable `textarea` of a fixed height ("Main content as Markdown"); **Copy as Markdown** copies it
  and announces "Markdown copied". Where the clipboard is not allowed it says so and opens the preview to
  select from.

## Citable facts

Read with a small JSON-LD reader of its own (`script[type=application/ld+json]`, up to 20 scripts of
200 KB, nodes with `@type` anywhere in them, `@id` references for names), plus meta tags and the page:

- **Page type** (always a note): article-like when `og:type` is `article`, the structured data has an
  Article type (`*Article`, `BlogPosting`, `Report`, ...), or the largest `article` has at least 200 words.
- **Author**: JSON-LD `author`, `meta[name=author]`, `[rel~=author]`, `[itemprop~=author]`; the reason names
  where. **Dates**: JSON-LD `datePublished`/`dateModified`, `article:published_time`/`modified_time`, and a
  rendered `<time datetime>` (`itemprop=datePublished` or `pubdate` first, then the first in the main
  content). **Publisher**: JSON-LD `publisher`, an Organization's or the WebSite's name, else
  `og:site_name`. **Sources**: rendered links to other sites (http and https) in the main content, with up
  to three hosts.
- On an article-like page, a missing author or date is worth a look (a page issue), and a shown date more
  than a day from every structured date is worth a look with both values (an issue on the `time`
  element). Found facts pass; a missing publisher or source is a note. On other pages every row is a note,
  without issues. Reasons are facts ("No author named in the page or its structured data.").

## AI suggestions

- **Suggest a title**, **Suggest a meta description** and **Questions this page answers**, with the line
  "Sends this page's main text to uier." under them. Nothing is sent before a button is pressed. Then
  `POST /api/page-suggestions` (a project's toolbar: `/api/review/<code>/page-suggestions`) gets
  `{ kind, text, title?, description? }`: the first 4,000 characters of the Markdown, and the title and
  meta description as the report read them ([the API](../../../docs/api.md#page-suggestions)).
- Up to three suggestions per kind, as plain text (React text, never markup), each with **Copy** (an icon
  button, "Copied") and, for a title or description, **Comment**: a comment about the page (the issue
  quick action's page feedback) with the check `{ type: 'seo', id: 'title' }` or `'description'`:
  `SEO: Suggested title for this page, from AI suggestions.`, then the suggestion and the current text as
  `foundLine` code spans. It goes through the panels' quick action (`ChecksContext`), so like the check's
  own issue there is one open thread a page: once a title suggestion is posted, or the page has an open
  thread from the Title check, the other title suggestions (and the Title row's issue) say "Reported as
  #12" with Show, to reply there.
- **Busy, not disabled**: a button asking for suggestions shows a spinner and `aria-busy`/`aria-disabled`,
  so the focus stays on it. Suggestions are kept in memory per page and kind while the panel is closed
  (each one was a paid request). Errors use the comments API's messages; a rate limit says when to try
  again, with View usage for a member.
- **Packaged clients** (the browser extension, `runtimeAdapters()`) have no suggestion buttons: the
  extension's closed route contract (`extensionContract.ts`, [extension adapter](extension-adapter.md))
  does not include the route, and it is not extended here. They also have no audit asset today, so the
  whole section renders nothing there.

## Tests

`apps/web/e2e/page-checks-ai-search.spec.ts` (Desktop Chrome) on `fixture-ai-search`
(`e2e/support/fixtures/aiSearch.ts`): the exact Markdown of an article in a `main` (without the site's
navigation, footer, a link's query or the toolbar), the Text and Not in the text rows, Copy as Markdown,
the citable facts with the date disagreement and its comment, no suggestion request before a button,
the request's body, three titles, Copy, a title posted as a comment with its check (the other titles then
reported), questions without Comment and the focus kept on their button, axe on the open panel, and the
suggestions kept after the panel closes; `?no-main`: the body without its chrome, and every fact a note.
Mobile Chrome: the section fits the panel and its controls are 44 px high. The API is in
`page-suggestions.api.spec.ts`.
