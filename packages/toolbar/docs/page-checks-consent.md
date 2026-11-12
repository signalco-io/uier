# Consent and cookies

The toolbar's **Consent and cookies** page tool sits beside Accessibility and SEO (Options on a
phone, and in the panel-title menu). The independent `consent` toolbar feature controls it. The
shared panel components provide docking, Close/focus, Check again, summary filters, guest names,
Comment on a finding, reported findings and browser-local Not an issue/Restore.

`src/checks/lazy/consent.ts` runs in the pinned audit asset; `components/checks/ConsentPanel.tsx`
defines the sections and shows them. Clients without an audit adapter omit this tool, like Accessibility. No background scan, remote classification service, extra
dependency or extension permission. The collector makes no network requests, clears no storage,
changes no consent and patches no page APIs.

## Page snapshot

- Reads cookie names visible to the document via Cookie Store when available, else `document.cookie`.
  Only `name`, optional `domain` and optional `expires` enter reports. Domain/expiry are non-standard
  Cookie Store extensions: an absent attribute stays unknown; `expires: null` explicitly means a
  browser-session cookie. A null exposed domain means host-only, shown as the current hostname.
  Cookie Store failures/timeouts fall back to cookie names without guessing attributes.
- Lists localStorage and sessionStorage **keys**, using `length`/`key()`, never `getItem` or stored
  values. Their domain is the page host. Local storage is persistent with unknown application expiry;
  session storage lasts for the tab session. Document-visible storage is labelled **First party
  (page context)**: this describes its context, not which script/vendor created it.
- Gives small, name-based category hints: common Google Analytics, Hotjar, Clarity and Mixpanel names;
  Meta/Google advertising names; known consent preferences; `theme`, `color-scheme` and `uier:`
  preferences. Everything else is unknown. No category establishes necessity or a legal obligation.
- Detects known banner selectors for Cookiebot, OneTrust, CookieYes, Didomi, Usercentrics and Klaro;
  known script hosts also identify a platform marker. A rendered, visible candidate is distinguished
  from an installed marker. Hidden/dismissed/custom banners and closed shadow roots can be missed.
  A marker or visible banner never proves a consent choice or the lack of an earlier one.
- Reads Resource Timing entries for a small known-host catalogue (Google Analytics, DoubleClick,
  Meta's script host, Hotjar, Clarity), retaining **hostnames only**. A resource is evidence of a
  recorded request, not proof of cookies, personal data or completed tracking. Known provider hosts
  outside the page's provider domain are labelled third party; arbitrary hosts are not classified
  by guessing public suffixes. Tag-manager presence alone is not treated as a tracker request.
- All existing storage has unknown creation/consent timing. Likely analytics/marketing names and
  known-host requests are suggestions **To review**. There are no green compliance/pass results.

## Before consent

The reviewer explicitly starts **Observe for 15 seconds**, following the instructions to use a fresh
browser session and wait before choosing consent. This is the reviewer's stated context, not a
machine-verified absence of prior consent. The toolbar does not click the banner or infer choices
from cookie values.

After the initial inventory, polling every 500 ms records new names and resource hostnames during
the 15-second window. Already-present names, changes to existing values, short-lived names between
polls and activity before the window are not established. Each finding says it was observed during
the reviewer-started window and needs human verification. No findings is a note, not proof of no
tracking. Closing the panel, collapsing the toolbar or leaving the page cancels it. Check again
clears the observation and refreshes the snapshot. Consent comments have no automatic thread
re-check: a new controlled observation is needed.

## Bounds and privacy

At most 100 names of each storage type, 100 new names per observation and the last 2,000 resource
entries are inspected; names display up to 160 characters. Truncation and denied storage access
are notes, never clean passes. Cookie Store calls time out after one second. Inventory and reports
stay in memory. Site-wide page summaries exclude all consent sections. A reviewer may explicitly
post a finding with `{ type: 'consent', id: 'consent-…' }`; its text contains names/metadata only,
within the existing 1,000-character comment limit. Values never enter reports, logs or payloads.

The panel always states its limits: HttpOnly/third-party cookies, frame storage,
IndexedDB, Cache Storage and server-side tracking are not inspected. Earlier consent and activity
before the toolbar loaded are unknown. It examines this page, never crawls the site, and makes no
legal-compliance claims.

## Research and tests

The scope was selected from established scanners' documented inventory fields and techniques:
[Cookiebot's technology list](https://support.cookiebot.com/hc/en-us/articles/360004155074-What-kinds-of-cookies-and-tracking-technologies-does-Cookiebot-find)
and [OneTrust's scan report fields](https://docs.onetrust.com/en/consent--preferences/cookie-consent/scanning-a-website-categorizing-and-maintaining-cookies/exporting-scan-results).
The page-side limitations follow [Cookie Store](https://developer.mozilla.org/en-US/docs/Web/API/CookieStore/getAll)
and [document.cookie](https://developer.mozilla.org/en-US/docs/Web/API/Document/cookie). A toolbar has
less visibility than a scanner controlling an entire browser session; its wording reflects that.

`apps/web/e2e/page-checks-consent.spec.ts`, Desktop and Mobile Chrome, uses `fixture-consent`:
inventory names/categories/lifetimes, visible and absent CMP markers, values excluded from the panel
and POST payloads, storage values never read, blocked storage, standard/optional cookie attributes,
new names versus existing-value changes, host-only resource reporting, observation cancellation,
Check again, comment persistence, dismissal/restore, responsive fit and axe. The toolbar-features
suite covers hiding the tool for guests and customized configurations. API coverage verifies its
comment-check contract and packet label.
