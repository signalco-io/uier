# Extension listing worksheet

Prepared copy and artwork for owner review. This is not a published listing. Complete the account,
reviewer access and disclosure forms in the [release runbook](browser-extension-release.md).

| Field | Draft |
| --- | --- |
| Name | uier |
| Summary | Review configured project sites with uier. Signed-in project membership required. |
| Category / language | Productivity / English; confirm the dashboard's current choices |
| Homepage | https://uier.io |
| Support | https://github.com/signalco-io/uier/issues |
| Privacy policy | https://uier.io/legal/privacy-policy |

## Description

Leave feedback directly on a configured project website, including signed-in pages, staging and
localhost. Open the extension, sign in to uier, choose a matching project and start a review. No
script installation or security-header changes are needed on the reviewed site.

Comments stay pinned to elements, selected text or areas. Reply, resolve and reopen threads with
the project's existing access rules. Screenshots are captured automatically within the visible
viewport. Authors can redact or replace saved screenshots. Review continues on reload and same-origin navigation in the active tab.
Exit review stops it; a different origin requires another explicit start.

Each reviewer needs the desktop extension in Chrome or Edge and access to a project containing the
exact site origin. Anonymous guest reviews use uier's script installation. Browser internal pages,
extension stores, local files and cross-origin iframe contents are unsupported.

## Single purpose and permission justifications

The single purpose is reviewing configured uier project sites by leaving on-page feedback.

| Permission | Why it is used |
| --- | --- |
| `activeTab` | Temporary access after the reviewer explicitly opens the action; injects the review layer and captures only the reviewed visible tab. Same-origin continuation ends on Exit, tab closure or origin change. |
| `scripting` | Injects the locally bundled toolbar into the top frame's isolated world. No remote executable code. |
| `storage` | Trusted local storage persists the separate refresh credential and pending renewal attempt. Access credentials, active bindings, verification proofs and bounded text/anchor drafts use trusted session storage and clear on browser restart. No images in drafts. |
| `identity` | Explicit first-party sign-in and consent using the exact extension callback, state and PKCE. |
| `https://uier.io/*` host | Worker API requests and the extension-owned first-party browser-verification frame. Does not grant access to every reviewed site. |

No all-sites, cookie-reading, history, offscreen or security-header rewriting permissions are used.

The dashboard's remote-code question is answered **Yes**, with the isolated hosted verification
frame disclosed. All extension-context logic is packaged locally; the cross-origin
`https://uier.io/extension-verification` frame runs hosted BotID without extension API access.
Its checked message supplies a short-lived proof, never executable commands. The
[MV3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
exempt remote code in contexts isolated from extension APIs, while still requiring reviewable
functionality and compliant data use. Do not describe this hosted frame as locally packaged code.

## Disclosure worksheet

Confirm the current store form's categories against actual behavior and the public policies. Do not
claim that the extension collects no data. It handles account identity; the site origin for matching
on action open; reviewed page URLs, selected text/anchors and context; submitted comments/replies;
and automatic screenshots. Signed-in/private sites may contain sensitive information: reviewers
choose where to leave feedback, and authors can redact or replace saved images. Data uses the project's existing authorization and
retention rules. The extension does not sell data, use it for advertising, collect browser history
or read unrelated tabs/cookies. Do not make retention promises beyond the public policy.

The refresh credential stays in trusted extension local storage to retain sign-in across restarts,
with 30-day inactivity and one-year absolute limits. Access credentials, bindings, proofs and unsent
text/anchor drafts stay in trusted session storage; images stay outside persistent drafts.
Sign-out clears local private data and revokes the separate
server session. Network transport goes to uier over HTTPS. The helper obtains BotID verification on
uier after explicit sign-in, independent of the reviewed page's CSP.

The prepared dashboard categories are personally identifiable information, authentication
information, personal communications, location (request IP information), web history (explicitly
reviewed URLs), user activity (submitted anchor/viewport context) and website content. This does
not imply a history-reading permission or continuous activity logging. Health and financial
collection are not the product's purpose. The publisher owner approved all three Limited Use
certifications, and they are saved in the draft.

## Artwork and reviewer instructions

After `pnpm build`, `pnpm -C apps/extension package`, `pnpm -C apps/extension test:package`, run
`pnpm -C apps/extension store:assets`. The release directory contains the canonical brand 128 px
store icon (a 96 px rounded plate with 16 px padding) and the 440×280 promotional tile (the social
card's lockup, tagline, address and pin/toolbar motif) in `listing/`; the persistent test retains an actual
1280×800 runtime screenshot in `test-results/`. Extension icons are 16/32/48/128 px. CI retains these
as artifacts; check the dashboard's current required sizes and visually review them before upload.
Screenshots use a local fictional project, never customer pages. Popup imagery comes from a
verified released build; the popup no longer carries a development-preview label.

The controlled HTTPS reviewer page is `https://uier.io/extension-demo.html`: plain fictional content
with no embed or executable page code, and a CSP that denies page resource loads. Reviewers sign
in with their own test identity and create an isolated project whose site is `https://uier.io`.
This self-service setup needs no shared password, customer workspace or maintainer-delivered code.
Record the supported sign-in and setup steps in the private dashboard reviewer notes. Explain project matching, Start review,
post/reply/resolve, visible-viewport screenshot, verification helper, Exit and sign-out. Ensure the
reviewer can receive a sign-in code without relying on a maintainer being online. Never include
customer tokens, passwords or one-time codes in a public issue or listing. Owners must verify those
live credentials and the hosted Chrome/Edge journey before submission.
