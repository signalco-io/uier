# Guides

`/guides` lists the guides; each guide is its own page under it: `/guides/client-website-reviews`,
`/guides/nextjs`, `/guides/browser-extension`, `/guides/website-review-checklist` and
`/guides/website-bug-report-template`. Their titles, descriptions and paths are in
`src/lib/guides.ts` (metadata, social cards and the tests read them there). Metadata, the sitemap and
the cards follow [search indexing](search-indexing.md) and [social cards](social-cards.md).

## Layout

Guides are visual and scannable: numbered steps with a picture each, short copy. The building blocks
are in `src/components/marketing/guides/`; use them only for the guides, and keep guide-only parts
there rather than in the shared marketing components.

- `GuideHeader`: a link back to `/guides`, the title, the description and the actions, with the
  outline beside them ("In this guide": every step and section, linked to its id). Its column
  aligns children to the start, so an action passed directly (a lone `Button`) keeps its own width
  instead of stretching across the column; `PageHeader` on the other public pages does the same.
- `GuideSteps` and `GuideStep`: the numbered steps on a rail. Each step is a `section` with its `id`
  and an `h2` (`${id}-title`), like `PageSection`, so tests find it as a region by its title. A small
  picture goes in `aside` (beside the step on wide screens), a wide one under the text. On small
  screens the number sits above the heading and the content takes the full width.
- Reference sections after the steps (troubleshooting, headers, help) use `PageSection`, so they
  read differently from the steps.
- `Tips` are titled cells with an outlined icon (Lucide, 1.75 stroke), in a panel of hairlines like
  `Panel`. `CodeWindow` shows a code example with its file name and marks the lines to add; its text
  stays the snippet exactly.
- `GuideTeaser` is a card on the index: picture, label, the title as the card's only link, the
  description.

Each guide keeps its `sections` object (id, title, number) in its page, and the outline is made from
it. Keep existing ids when a section is renamed (the client guide's first step keeps
`prepare-the-review`); links elsewhere may use them.

## Pictures

`GuideSpecimens` draws the pictures from the tokens, like the landing's specimens: never
screenshots, hidden from assistive technologies, the landing's imaginary restaurant site as the
example. Each copies the shipped control it shows, and its comment names it: the app's Site
addresses, install guide tabs and Copy the script, Who can comment (`projectAccessLabels`), review
links (`?toolbar-code=`), Check installation, the toolbar pill (`ToolbarIllustration`), New comment
with its screenshot toggle, and the extension popup's states. Recheck them when those change. The
client guide also reuses `PinnedSpecimen`, `BoardSpecimen` and `FixVerificationSpecimen` unchanged.
Highlights in pictures are neutral (ink outline, muted fill); blue stays for a commented text range,
a commented area, unread and links (BRAND.md).

Keep the pictures' text out of what the tests look up: no second `pre code` on the Next.js guide, no
element whose text is exactly a label the extension test finds (Omit screenshot, the Firefox notice,
the store button's label), and no list items in the extension guide's install section other than the
three steps.

## Copy

Every fact comes from the shipped product: the app's labels, `src/lib/extension/release.ts` for the
extension (see [browser extension](browser-extension.md)), `nextJsSnippet` for the Next.js example.
Shorten rather than add. A step is a title and one or two short sentences.

The checklist scopes a human review, includes content/layout/responsive/interaction/accessibility
checks and a fictional filled example, and separates Pass/Finding/Not checked from certification.
The report template records expected/actual behavior, steps, page/environment, available context and
checked evidence; it promises no replay/console/network diagnostics. The client guide's added brief
and review-round sections retain earlier anchor ids and distinguish team practice from mandatory
workflow or site-level approval. Examples are fictional and contain no real customer data.

`src/lib/guides/reviewResources.ts` owns the reusable text. `CopyableGuideText` adds only an explicit
clipboard write to server-rendered `CodeWindow` children, never reads the clipboard, announces success
and selects/focuses the visible preformatted text when copying fails. It uses the public UI-kit Button.
`PracticalReviewSpecimens` draws static decorative notes, not scores or invented diagnostics.
Keep setup and handoff claims synchronized with [review workflow](../../../docs/review-workflow.md),
[feedback export](../../../docs/feedback-context.md), current checks/triage/verification pages and
dated integration qualification. New practical content does not add a blogging engine or analytics.

## Tests

`e2e/guides.spec.ts` follows the index to the Next.js guide and on to the client guide, checks the
snippet, the outline links, the back link and accessibility of every guide. `browser-extension.spec.ts`
checks the extension guide's sections, labels and problems; `seo.api.spec.ts`,
`social-cards.api.spec.ts` and `footer.spec.ts` include the guide paths.
