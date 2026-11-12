# Security and compliance

The Security and compliance tool combines [consent inventory and observation](page-checks-consent.md)
with bounded security observations. Its name is translated in all six languages, including toolbar,
Options, panel-title menus, feature settings, anchor descriptions and exported comment-check labels.
The stable `consent` feature, panel/storage IDs and comment-check type remain unchanged for old
clients, saved panels, dismissals and stored comments. New security check IDs start `security-`.

`components/checks/SecurityPanel.tsx` uses the existing panel shell, summary filters, docking,
keyboard/touch controls, guest names and finding actions. The tabs are Page snapshot, Page security,
Response headers and Before consent. Each tab's limits are behind the info button at the end of the
tab row, not a paragraph in it (`data-uier-security-limits`, `data-uier-security-header-scope`), and its
section headings, which repeated the tab's name, are for screen readers only. Before consent keeps its
instructions in view. The summary counts individual passed checks, suggestions to
review and notes. It is not a grade, a security certification or a legal compliance verdict.

## Research and scope

Comparable tools inspect more than a script in the reviewed page can see:

- [MDN HTTP Observatory](https://developer.mozilla.org/en-US/observatory/docs/tests_and_scoring)
  tests HTTP security mechanisms and explains that suitability depends on the site.
- [Security Headers' documented report](https://securityheaders.com/api/docs/) includes CSP, HSTS,
  X-Content-Type-Options, framing, Referrer-Policy and Permissions-Policy. This implementation uses
  no external scanner, API key or remote classification service.
- [Chrome's security guidance](https://developer.chrome.com/docs/modern-web-guidance/guides/security/security)
  covers CSP, mixed content, cookie settings and framing. DevTools can see network and policy
  violations that an injected page script cannot recover retrospectively.
- [Cookie Store](https://developer.mozilla.org/en-US/docs/Web/API/CookieStore/getAll) may expose
  optional `secure` and `sameSite` metadata. Missing metadata stays unknown. Browser JavaScript
  [cannot read Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie),
  so this tool never infers complete cookie flags from response headers or document.cookie.

We selected observations with page-side evidence. TLS/certificate configuration, server
vulnerabilities, HttpOnly cookies, third-party/frame storage and sensitive-file exposure are not
assessed. No directory discovery, source-map downloads, script-body inspection, sensitive-file
probes, remote scans or extension permissions are added. A recorded map request is not proof that
its contents are publicly accessible. CSP policy presence is not a bypass-resistance test.

## Page security

`src/checks/lazy/security.ts` runs in the pinned audit asset when the panel opens and on Check again,
never in the background. It makes no requests and does not patch APIs or mutate storage.

| Check | Evidence and result |
| --- | --- |
| Page transport | HTTPS in the current address passes this specific observation; HTTP is a suggestion to review. TLS/certificate details remain untested. |
| HTTP references on HTTPS | The inspected resource attributes and form targets declare HTTP URLs. This is a suggestion to review; browsers can upgrade or block them, so insecure delivery is not claimed. Ordinary navigation links are excluded. |
| Cross-origin script integrity | Executable external script tags without a nonempty integrity declaration are suggestions to review. Stable CDN files may support SRI; dynamic scripts may not. Present hashes, CORS and execution are not verified. Inert data-script types are excluded. |
| Cookie flags | Cookie Store names are shortened with `redactName`. Only exposed boolean Secure and recognized SameSite values are retained. Secure=false is a suggestion to review; other/missing metadata stays a note. Effective metadata does not prove explicit Set-Cookie attributes, cookie purpose or HttpOnly coverage. document.cookie is not used to infer flags. |
| Observed source-map requests | Resource Timing records an HTTP(S) URL whose path ends .map. Only a shortened address is shown, as a suggestion to review. No source files or maps are requested or read. No observed request is a note, not an exposure test. |
| Sensitive files | Always Not checked: no paths are probed. |

At most 1,000 matching document elements, 100 findings per check, 100 cookies and the last 2,000
resource timings are inspected. Reaching a bound adds a partial-inspection note. Cookie Store has
a one-second timeout; denial or missing attributes never become clean passes. The snapshot does
not inspect all CSS, runtime requests, alternate image candidates, frames or closed shadow roots.
The page's toolbar host and inline thread contents are excluded by the shared node check.

## Response headers

Only **Check response headers** requests a response. It makes one same-origin GET of the current
address with a pristine `fetch`: the one of a hidden `about:blank` frame added for the request and removed
after it (`pristineFetch.ts`), so a page that wraps its own `window.fetch` cannot add credentials, cookies or
headers to it (a page embedding uier is not trusted). Where no such frame can be made, the headers are Not
checked. The request has `credentials: omit`, `mode: same-origin`, `redirect: manual`, `cache: no-store`,
`referrerPolicy: no-referrer` and a five-second timeout. The body is cancelled without reading it.
The hash and uier's `toolbar-code`, `uier-token`, `uier-comment` and `review` controls are removed.
Action-like or credential-bearing paths/queries are skipped, including encoded forms. No redirect
is followed, and no uier authentication headers, cookies or page referrer are sent.

Only a successful HTML response is interpreted. A redirect, access refusal, error, non-HTML,
timeout, network/CSP/browser denial or unsupported address produces five **Not checked** notes,
not missing-header findings. Every header comment identifies the fresh anonymous response; it may
differ from the original navigation and the signed-in page. No original navigation headers are
claimed. Check again clears this manual report without issuing another request. Closing the panel,
collapsing the layer or leaving the page aborts work; stale runs cannot replace newer reports.

`securityRules.ts` owns the pure observations:

- CSP: no enforcing header is a suggestion to review, including report-only-only responses.
  Unsafe eval tokens or unsafe inline without a script nonce/hash are identified conservatively.
  Other present policies are notes requiring a full review, never an automatic CSP pass. First
  duplicate directives win; multiple policies and script-src-elem precedence are considered.
- HSTS: only evaluated on HTTPS. A single valid positive max-age passes the declaration check;
  zero, invalid or duplicated max-age is a suggestion. Subdomains and preload are not required
  or claimed. There is no site-wide HSTS/TLS grade.
- X-Content-Type-Options: only nosniff passes.
- Framing: recognized restrictive frame-ancestors or DENY/SAMEORIGIN declarations pass the
  declaration check. Enforced frame-ancestors takes precedence over X-Frame-Options. Broad,
  unknown or oversized policies remain undecided; required embedding depends on the site.
- Referrer-Policy: the last recognized comma-separated policy applies. Policies permitting full
  cross-origin URLs are suggestions to review. An absent header is a note because browser defaults
  or a meta policy can apply; absence alone does not prove a leak.

CSP is inspected up to 16 KiB; oversized policy interpretation stays undecided. Raw policies,
nonces, hashes and header values do not enter reports. Addresses omit credentials, queries and
fragments, shorten identifier-like path segments and are capped at 240 characters. Cookie values,
storage values and script bodies are never read into security reports or comments. Reports remain
in memory until the reviewer explicitly posts a finding through the existing comment action.
Security and consent reports stay out of the app's site-wide Accessibility/SEO summaries. They
have no automatic thread re-check; use a fresh check/controlled observation in this panel.

## Verification

`page-checks-security.api.spec.ts` covers header value semantics, CSP/meta/report-only boundaries,
framing precedence, duplicate/oversized policies, referrer fallbacks, action exclusions, review
parameter removal and address redaction. `page-checks-security.spec.ts` runs on desktop/mobile:
no automatic requests, anonymous requests without cookies/referrer/authentication, skipped
redirects, access refusals, CSP denial, action URLs and pending-request cancellation, privacy-safe comments, Check again reset, HTTPS DOM evidence,
optional cookie metadata, no value reads or file probes, responsive fit and light/dark accessibility.
The existing consent suite retains inventory, redaction, observation and dismissal coverage;
toolbar-feature coverage retains hidden/restored panel and guest restrictions.
