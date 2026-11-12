/** Editorial templates, not captured customer feedback or automatic diagnostics. */
export const websiteReviewChecklist = `Review scope
Site/environment:
Pages and journeys:
Reviewers and decision owner:
Browsers, viewport sizes and assistive technology:
Out of scope:
Review round and handoff date:

[ ] Content: names, prices, spelling, links and meaningful image descriptions.
[ ] Layout: hierarchy, spacing, image crops, long text and empty/error states.
[ ] Responsive: narrow/wide screens, zoom, menus and horizontal scrolling.
[ ] Interactions: navigation, forms, validation, confirmation and recovery.
[ ] Accessibility: keyboard order, visible focus, labels and readable content.
[ ] Findings: one problem per thread, expected/actual result and reproduction steps.
[ ] Evidence: correct page/environment, available browser context, checked screenshot.
[ ] Handoff: owner, priority and next action for every unresolved finding.
[ ] Retest: repeat the original steps after the change is deployed.

Record Pass / Finding / Not checked for each item. A tick is a human review note,
not accessibility certification, a security audit or approval of a whole release.`;

export const bugReportTemplate = `Title: [one observable problem]

Page and environment: [safe page address; staging/production]
Where: [element, selected words, area or whole page]
Expected: [what should happen]
Actual: [what happened instead]

Steps to reproduce:
1. [starting state]
2. [action]
3. [observed result]

Browser / operating system: [available details, or unknown]
Viewport / input: [size; touch, mouse or keyboard]
Evidence: [checked screenshot, or explain why it is unavailable]
Impact: [who is affected and what is blocked]

Do not include passwords, tokens, private query values or customer data.
After the change: repeat these steps in the same environment.`;

export const bugReportExample = `Title: Booking confirmation is hidden below the mobile menu

Page and environment: https://restaurant.example/booking — staging
Where: the booking form's confirmation message
Expected: after sending the form, the confirmation is visible.
Actual: the menu covers the confirmation until it is closed manually.

Steps to reproduce:
1. Open the staging booking page at a 390 px viewport.
2. Open the menu, then follow its booking link.
3. Fill the test form and send it. The open menu covers the result.

Browser / operating system: record the browser used for this check; unknown here.
Viewport / input: 390 px wide; touch.
Evidence: attach a checked screenshot if capture succeeds.
Impact: a reviewer cannot tell whether the booking request was received.

Retest: repeat the same steps after deployment and check the confirmation.`;

export const clientReviewBrief = `Review: restaurant website — staging
Scope: home, menu and booking pages; content, layout and the booking journey.
Audience: the client reviewers invited to this project.
Environment: the configured staging address; keep production feedback separate.
Check: one narrow viewport, one wide viewport, and keyboard navigation.
Out of scope: payment handling, a security audit and legal approval.

Round 1: check content and journeys; leave one problem per thread.
Round 2: retest deployed fixes against each thread's original steps.
Handoff: list unresolved threads, their owners, priority and next decision.

Use the review link. Do not include customer data in screenshots.
Done is ordinary completion. Request verification for a named reviewer
when one thread's fix needs confirmation; this does not approve the whole site.`;
