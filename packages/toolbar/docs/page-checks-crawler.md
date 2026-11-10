# SEO panel: Crawlers

The SEO panel's Crawlers section (first in its Search tab) says what a crawler gets from the page, which the
document alone cannot tell: the response to a request without cookies, the HTML the server sends
against the rendered page, robots.txt for search and AI crawlers, the sitemap and llms.txt. It is a
section of the [page checks](page-checks.md#sections): the logic is `src/checks/lazy/crawler.ts` (in
the audit asset), the rules it reads files with are `src/checks/lazy/crawlerRules.ts` (no DOM, no
requests), the view is `components/checks/sections/CrawlerSection.tsx`.

## When it runs

- `when: 'panel'`: when the SEO panel opens and on Check again, never in the background (it sends
  requests). The report is kept for the page while it is open (`PageChecks`), so opening the panel
  again requests nothing.
- robots.txt and llms.txt are requested once per origin and kept in the module's memory, with what was
  read of the sitemaps: another page of the site (a client-side navigation) reuses them, and the
  sitemaps are read on from where they stopped. A page checked again (Check again, or a page visited
  before) requests them again. A full page load starts over.

## Requests

- Same-origin `GET`s only, the way an anonymous crawler asks: `credentials: 'omit'`, `cache: 'no-store'`,
  `referrerPolicy: 'no-referrer'`, redirects followed, `context.signal` and a 10 s timeout on each, bodies
  read up to a limit: the page 5 MB, robots.txt 500 KiB (what RFC 9309 asks crawlers to read), llms.txt
  1 MB, sitemaps 5 files and 5 MB in all per origin (a gzip sitemap is unpacked). The page's address is
  `location.href` without the hash.
- The page first. When the site's Content-Security-Policy blocks it (a `securitypolicyviolation` event for
  `connect-src` with this origin while the request runs, enforced, not only a failed `fetch`), the section
  is one note, "Not checked: the site's Content-Security-Policy blocks requests to its own origin.", and
  nothing else is requested. A failed request, a timeout or a redirect the browser cannot follow (to
  another site without CORS, found with a second `redirect: 'manual'` request) is a note on its row.
- Then robots.txt and llms.txt, then the sitemaps. Nothing leaves the browser: the answers are read here.

## Rows

States follow the panel's rules: `warn` only for clear cases, each with a page issue whose comment
says what was requested (`GET <address>` through `writtenAddress`, no query) and what came back.

| Row (`crawl-…`) | Pass | Warning | Note |
| --- | --- | --- | --- |
| Response (`status`) | 2xx | 4xx or 5xx (not 401/403) | 401/403, a redirect to another page or site ("Sites under review are often protected on purpose"), a redirect to this page's address, a failure |
| X-Robots-Tag (`x-robots-tag`) | not sent, or no `noindex` | | `noindex` or `none` for every crawler, Google (`googlebot:`) or others ("The response asks search engines not to index the page."), and when the robots meta tag disagrees |
| Search crawlers (`robots`) | Googlebot, Bingbot and the `*` group may read the page; no robots.txt (404) | one of them is blocked on a page that may be indexed | blocked on a noindex page; robots.txt answers another 4xx (counts as none), 5xx, an HTML page, or fails |
| AI crawlers (`robots-ai`) | | | always: who is blocked, and how many of the list may read the page |
| Sitemap (`sitemap`) | the page is listed | not listed, every sitemap read, on a page that may be indexed (canonical to itself) | not listed in part of the sitemaps, on a noindex page or with a canonical elsewhere; no sitemap; a sitemap on another origin |
| Served h1 (`served-h1`) | the served HTML has the page's first h1 | the page has an h1 and the served HTML none ("The h1 is added by JavaScript.") | the served h1 differs; no h1 |
| Served text (`served-text`) | 90% or more of the page's text | under 50% of a page with 200 characters or more | between, or too little text |
| Served head (`served-head`) | the served HTML has the page's title, description, canonical and robots meta tag as they are | | one is added, changed or removed by JavaScript |
| Served links (`served-links`) | 90% or more of the page's link addresses | | fewer; no links |
| llms.txt (`llms`) | | | always: found and links the page or not, or not there; "No search engine confirms using it." |

- The served HTML is compared only when the request got this page (2xx, same origin and path); otherwise
  one note, "Not compared: the request did not get this page." It is parsed with `DOMParser` (inert:
  nothing runs or loads). Text is `textContent` of both bodies without `script`, `style`, `noscript`,
  `template`, the toolbar's host and inline thread slots, compared word by word: the characters of the
  page's words that the served text also has (each as often as it has it). Words are split on white
  space, so a language written without spaces compares in long runs. Links are distinct `http(s)`
  addresses, resolved against each document's base.
- "May be indexed": no `noindex`/`none` in the robots or googlebot meta tag or in the header (for every
  crawler or Google), and the request got the page. The reasons never say what a crawler does with
  JavaScript; they say that crawlers that do not run JavaScript get only the served HTML.

## robots.txt (RFC 9309)

`parseRobots` and `robotsVerdict` in `crawlerRules.ts`:

- Groups start at user-agent lines (one after rules starts the next); rules before any group are ignored;
  `Sitemap` lines and unknown records (Crawl-delay) belong to no group and do not end one. A group's
  product token is the value's leading letters, `_` and `-` (`Googlebot/2.1` is `googlebot`), compared
  case-insensitively. A crawler's own groups are combined; without one, the `*` groups apply; without
  either, everything is allowed. An empty `Disallow:` is no rule but keeps its group.
- The page's path and query are matched from their start; `*` is any run of characters, a final `$` the
  end. The longest pattern wins, `Allow` on a tie. Paths and patterns are compared percent-encoded (UTF-8,
  upper-case hex, unreserved characters decoded). `/robots.txt` is always allowed. Matching tracks every
  position a pattern can reach, so it never backtracks.
- No robots.txt (404, 410) lets every crawler read the site; another 4xx counts as none too (RFC 9309); a
  5xx is a note that RFC 9309 asks crawlers to treat every page as blocked then; an HTML page (a
  single-page app's server) has no rules.
- The AI crawlers (`aiCrawlers`), each checked against its vendor's documentation, linked beside it in
  the code: GPTBot, OAI-SearchBot, ChatGPT-User (OpenAI), ClaudeBot, Claude-SearchBot, Claude-User
  (Anthropic), PerplexityBot, Perplexity-User, Google-Extended, Applebot-Extended, CCBot (Common Crawl),
  meta-externalagent (Meta) and Amazonbot. Bytespider is left out: ByteDance publishes no page that
  could be confirmed. The tokens change: check the links before changing the list. Their row folds a
  list of each with its vendor, what it is for and the rule that applies.

## Sitemaps

- The `Sitemap` lines of robots.txt (those on another origin are named, not read), else `/sitemap.xml`.
  `<loc>` elements are read with a pattern (a file cut at the limit still gives what it has; `image:loc`
  is not a page); a `<sitemapindex>` queues its sitemaps on this origin; a file without `<` is a text
  sitemap. Reading stops once the page is found.
- The page is the canonical address when the page has one, else its own; addresses compare by origin and
  path without a trailing slash. Not listed is a warning only when every sitemap was read; otherwise the
  note says how many addresses were read and why the rest was not.

## llms.txt

Whether `/llms.txt` is there (a 4xx or an HTML page is not) and whether it links this page (Markdown
links and bare addresses; a page's `.md` version counts). Always a note.

## Tests

- `apps/web/e2e/page-checks-crawler.api.spec.ts` (API): a table of robots.txt cases (groups, case,
  combined groups, longest match, Allow on a tie, `*` and `$`, the query, percent-encoding, empty
  Disallow, rules before a group), the matcher's bounds, X-Robots-Tag per crawler, sitemap entries
  (index, entities, CDATA, `image:loc`, a cut file, text sitemaps), llms.txt links, the text share and
  page addresses.
- `apps/web/e2e/page-checks-crawler.spec.ts` (Desktop Chrome) on `fixture-crawler`
  (`e2e/support/fixtures/crawler.ts`): nothing requested before the SEO panel opens; every row of a listed
  page; the AI crawlers' list; the kept report; a client-side navigation reusing robots.txt and reading
  the sitemaps on; the sitemap warning's comment; Check again requesting again; axe on the open panel.
  A page whose h1, text, links and description a script adds (the h1 warning's comment), an
  `X-Robots-Tag: noindex` page whose meta tag disagrees, a page robots.txt blocks (its comment with the
  lines), a redirect to a sign-in and a 404 for requests without cookies, and a CSP without the site's
  own origin in `connect-src` (one note).
