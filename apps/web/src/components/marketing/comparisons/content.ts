import { brand } from '@uier/brand';
import type { WorkflowKind } from './WorkflowPicture';

const originalReview = { date: '2026-11-11', label: '11 November 2026' };
const currentReview = { date: '2026-11-15', label: '15 November 2026' };
const editingReview = { date: '2026-11-19', label: '19 November 2026' };
type Review = { date: string; label: string };
type Source = { label: string; url: string; reviewed?: Review };
export type Support = 'yes' | 'limited' | 'no' | 'unknown';
export type Fact = { support: Support; label: string; detail: string; source?: string; additionalSource?: Source };
export const dimensions = [
    { id: 'website', name: 'Comments on a live website' },
    { id: 'editing', name: 'Demonstrating CSS and text changes' },
    { id: 'context', name: 'Screenshot and browser context' },
    { id: 'recording', name: 'Screen and audio recording' },
    { id: 'replay', name: 'Session replay before a report' },
    { id: 'diagnostics', name: 'Console and network capture' },
    { id: 'assets', name: 'File and design proofing' },
    { id: 'research', name: 'Surveys and request voting' },
    { id: 'workflow', name: 'Organizing the work' },
    { id: 'confirmation', name: 'Reviewing a finished fix' },
    { id: 'mcp', name: 'MCP for coding tools' },
    { id: 'checks', name: 'Accessibility and SEO checks' }
] as const;
export type Dimension = typeof dimensions[number]['id'];
export type Product = {
    name: string;
    reviewed: Review;
    kind: WorkflowKind;
    focus: string;
    bestFor: string;
    facts: Record<Dimension, Fact>;
    setup: string;
    pricing: string;
    pricingUrl: string;
    integrations: string;
    integrationUrl: string;
    sources: Source[];
};

const fact = (support: Support, label: string, detail: string, source?: string): Fact => ({ support, label, detail, source });
const unverified = (source: string) => fact('unknown', 'Not verified', 'The sources checked do not establish support or absence.', source);

export const uier: Product = {
    name: brand.name, reviewed: currentReview, kind: 'review', focus: 'Live-page review → a checked fix',
    bestFor: 'Preview proposed text and style changes on the page, assign the feedback and ask a named reviewer to check the fix.',
    facts: {
        website: fact('yes', 'Element, text, area and drawing', 'Review the actual page with anchored comments or draw a change on the page.', '/features/pinned-comments'),
        editing: fact('yes', 'On-page text and style previews', 'With Text rewrites available, propose replacement text, text and background colors, text size and weight, padding and corner radius on one eligible element. Switch between Original and Proposed on the page while the target matches. Copy the exact values from the thread for your team to implement in the site’s source.', '/features/pinned-comments#preview-a-change'),
        context: fact('limited', 'Screenshot and device details', 'Capture is attempted and can be omitted. Saved images can accompany original messages and replies; device details depend on browser support and are visible to project members.', '/features/screenshots'),
        recording: fact('yes', 'Short screen recordings', 'Attach a recording up to 60 seconds and 25 MiB. Browser capture needs permission and a secure context; upload MP4 or WebM when capture is unavailable. Built-in capture has no audio and ends on full-page navigation.', `${brand.repository}/blob/main/docs/recordings.md`),
        replay: fact('no', 'Not supported', 'No timeline of what happened before a report.'),
        diagnostics: fact('no', 'Not supported', 'Browser details are captured; console logs and network requests are not.'),
        assets: fact('no', 'No file proofing', 'Images can accompany a thread. There are no PDF, design-file, video or email review canvases.'),
        research: fact('no', 'Not supported', 'No NPS or CSAT surveys, public voting board or product roadmap.'),
        workflow: fact('yes', 'Custom statuses and labels', 'Up to 30 workspace statuses, with project overrides, grouped under Open, In progress, Ready to verify, Done and Archive. Search covers the authorized project scope with paged results; bulk actions affect at most 50 shown threads. No due dates.', `${brand.repository}/blob/main/apps/web/docs/project-settings.md#custom-statuses`),
        confirmation: fact('limited', 'Named reviewer per thread', 'An admin enables fix verification for the project. A member can then request a reviewer’s check. Ordinary Done and admin overrides remain separate; this is not release or asset-version approval.', '/features/fix-verification'),
        mcp: fact('yes', 'Read and approved actions', 'Coding tools can work with feedback. An agent cannot confirm a fix.', '/features/ai'),
        checks: fact('limited', 'In-browser page checks', 'Accessibility and SEO checks on reviewed pages; no site-wide scheduled crawler or compliance certification.', '/features/page-checks')
    },
    setup: 'Create a project and use the script, a review link or the desktop extension. Guest commenting depends on the project’s access settings. Test the chosen route on your site, including its login and content security policy.',
    pricing: brand.pricing, pricingUrl: '/#pricing',
    integrations: 'Send shared feedback to GitHub, Linear, Azure DevOps, Notion or Slack. Sync options depend on the destination. Connect Claude Code, Codex or Cursor through MCP, or use the project-scoped REST API for a custom integration.',
    integrationUrl: '/integrations',
    sources: [
        { label: 'uier review workflow and limits', url: `${brand.repository}/blob/main/docs/review-workflow.md` },
        { label: 'uier capture and device context', url: `${brand.repository}/blob/main/packages/toolbar/src/feedbackContext.ts` },
        { label: 'uier recording scope and limits', url: `${brand.repository}/blob/main/docs/recordings.md` },
        { label: 'Custom statuses and labels', url: `${brand.repository}/blob/main/apps/web/docs/project-settings.md#custom-statuses` },
        { label: 'Paged project search and bulk selection', url: `${brand.repository}/blob/main/apps/web/docs/comments-inbox.md#paged-project-comments` },
        { label: 'Drawings and protected reply images', url: `${brand.repository}/blob/main/docs/feedback-context.md` },
        { label: 'uier features and pricing', url: '/#features' },
        { label: 'On-page text and style previews', url: '/features/pinned-comments#preview-a-change', reviewed: editingReview }
    ]
};

const bugherdSources = {
    features: 'https://bugherd.com/features', pricing: 'https://bugherd.com/pricing',
    video: 'https://bugherd.com/video-feedback-tool', board: 'https://bugherd.com/use-case/website-qa-tool',
    mcp: 'https://bugherd.com/feature/mcp', editing: 'https://bugherd.com/feature/suggest-text-edits',
    setup: 'https://support.bugherd.com/en/articles/11424313-get-feedback-from-clients-on-websites-and-files'
};
const markerSources = {
    pricing: 'https://marker.io/pricing', integrations: 'https://marker.io/integrations',
    annotation: 'https://marker.io/website-design-feedback',
    replay: 'https://help.marker.io/en/articles/6673880-session-replay-videos',
    handoff: 'https://help.marker.io/en/articles/14430683-why-are-console-logs-network-requests-and-replays-linked-instead-of-attached'
};
const usersnapSources = {
    features: 'https://usersnap.com/features', pricing: 'https://usersnap.com/pricing', integrations: 'https://usersnap.com/integrations',
    recording: 'https://help.usersnap.com/docs/feedback-with-a-screen-recording',
    annotation: 'https://help.usersnap.com/docs/feedback-with-a-screenshot',
    diagnostics: 'https://help.usersnap.com/docs/console-recorder-feature', mcp: 'https://usersnap.com/integrations/mcp'
};
const pastelSources = {
    faq: 'https://usepastel.com/faq', pricing: 'https://usepastel.com/plans',
    editing: 'https://help.usepastel.com/en/articles/5063677-editing-text-in-a-canvas',
    website: 'https://help.usepastel.com/en/articles/1996011-reviewing-websites-in-pastel',
    files: 'https://help.usepastel.com/en/articles/5395323-review-pdfs-and-image-files-in-pastel',
    approvals: 'https://usepastel.com/blog/approvals'
};
const userbackSources = {
    features: 'https://userback.io/features/', pricing: 'https://userback.io/pricing/',
    recording: 'https://userback.io/feature/video-feedback/',
    annotation: 'https://userback.io/feature/screen-annotation/',
    replay: 'https://support.userback.io/en/articles/17212348-feedback-session-replay-vs-full-session-replay-what-s-the-difference',
    workflow: 'https://support.userback.io/en/articles/5209239-configure-your-feedback-settings',
    setup: 'https://userback.io/feature/browser-extension/',
    integrations: 'https://userback.io/feature/integrations/', mcp: 'https://docs.userback.io/docs/userback-mcp'
};
const ruttlSources = {
    features: 'https://www.ruttl.com/', pricing: 'https://www.ruttl.com/pricing',
    comments: 'https://www.ruttl.com/features/comment-on-website',
    webApps: 'https://www.ruttl.com/features/review-web-applications',
    editing: 'https://www.ruttl.com/blog/marker-io-alternatives-best-web-annotation-bug-reporting-tools',
    integrations: 'https://www.ruttl.com/features/integrations', mcp: 'https://www.ruttl.com/mcp'
};

export const competitors = {
    bugherd: {
        name: 'BugHerd', reviewed: originalReview, kind: 'board', focus: 'Visual reports → a custom task board',
        bestFor: 'Website and design feedback that needs recorded explanations and a customizable Kanban workflow.',
        facts: {
            website: fact('yes', 'Element-pinned feedback', 'Website comments and suggested text replacements.', bugherdSources.features),
            editing: fact('limited', 'Text replacement in a pinned task', 'Select text on the page and propose a replacement. The pinned task saves both the original and the replacement. On-page previews of the new text or CSS are unverified.', bugherdSources.editing),
            context: fact('yes', 'Screenshot and metadata', 'Browser, OS, resolution and element context.', bugherdSources.features),
            recording: fact('yes', 'Video with audio', 'Short screen recordings; the video guide describes a one-minute timer.', bugherdSources.video),
            replay: unverified(bugherdSources.features),
            diagnostics: unverified(bugherdSources.features),
            assets: fact('yes', 'Files and Figma', 'PDFs, images and Figma designs alongside websites.', bugherdSources.pricing),
            research: unverified(bugherdSources.features),
            workflow: fact('yes', 'Custom Kanban columns', 'Assignment, priority and due dates on a project board.', bugherdSources.board),
            confirmation: unverified(bugherdSources.board),
            mcp: fact('yes', 'MCP, currently beta', 'Read task context, update tasks and add comments; included for subscribers.', bugherdSources.mcp),
            checks: unverified(bugherdSources.features)
        },
        setup: 'Install the site script, browser extension or WordPress plugin. With extension-only setup, reviewers also need the extension. Shared-link feedback asks for a name and email on first submission and creates a guest account.',
        pricing: 'Paid plans bundle member seats with unlimited clients and projects. Integrations and controls depend on the plan; check entitlements before switching.',
        pricingUrl: bugherdSources.pricing,
        integrations: 'Slack, Trello and GitHub on Standard. Jira, Asana, Linear, ClickUp and Monday.com are listed as Premium integrations.',
        integrationUrl: bugherdSources.pricing,
        sources: [
            { label: 'Features and capture', url: bugherdSources.features }, { label: 'Video recording', url: bugherdSources.video },
            { label: 'Kanban workflow', url: bugherdSources.board }, { label: 'Plans, files and integrations', url: bugherdSources.pricing },
            { label: 'Client access and setup', url: bugherdSources.setup }, { label: 'BugHerd MCP', url: bugherdSources.mcp },
            { label: 'Text replacement suggestions', url: bugherdSources.editing, reviewed: editingReview }
        ]
    },
    'marker-io': {
        name: 'Marker.io', reviewed: originalReview, kind: 'diagnostics', focus: 'Bug report → reproduction evidence',
        bestFor: 'Developer bug reports that need session replay, console and network evidence, or a wider choice of issue trackers.',
        facts: {
            website: fact('yes', 'Visual website reports', 'Annotated screenshots with an embedded widget or extension.', markerSources.pricing),
            editing: fact('unknown', 'On-page edits not verified', 'Marker.io documents annotating a captured screenshot to explain design or copy feedback. On-page text and CSS previews are unverified.', markerSources.annotation),
            context: fact('yes', 'Screenshot and metadata', 'Browser, OS, viewport and page URL.', markerSources.pricing),
            recording: fact('unknown', 'Recording not verified', 'The replay guide distinguishes replay from video recording, described as under development.', markerSources.replay),
            replay: fact('limited', 'Selected paid plans', 'Up to 2.5 minutes before submission; canvas, WebGL and Shadow DOM have limitations. Team, Business and eligible Agency plans include replay.', markerSources.replay),
            diagnostics: fact('limited', 'Selected paid plans', 'Console logs and network requests. Full diagnostics stay in Marker.io and are linked from the ticket.', markerSources.handoff),
            assets: unverified(markerSources.pricing),
            research: unverified(markerSources.pricing),
            workflow: fact('yes', 'Issue-tracker handoff', 'Route reports into a connected task tool. Integration availability depends on the plan.', markerSources.integrations),
            confirmation: unverified(markerSources.pricing),
            mcp: fact('yes', 'MCP listed', 'The current plan matrix includes AI and MCP capabilities; check the selected plan.', markerSources.pricing),
            checks: fact('limited', 'Scheduled monitoring', 'Accessibility and content checks are listed. The matrix marks broken links and SEO as coming soon, although the FAQ describes broken links as current; verify that availability.', markerSources.pricing)
        },
        setup: 'Use the JavaScript snippet, desktop browser extension or WordPress plugin. Reporters can submit without a Marker.io account. Check the capture route on private or authenticated pages.',
        pricing: 'Paid plans. Session replay, console/network diagnostics and Jira are included in Team, Business and eligible Agency plans. Reporting and internal team access have different roles.',
        pricingUrl: markerSources.pricing,
        integrations: 'Includes Jira, GitHub, GitLab, Linear, Azure DevOps, Asana, Trello, ClickUp, Notion and Slack. Some marketplace entries are coming soon; verify your destination and plan.',
        integrationUrl: markerSources.integrations,
        sources: [
            { label: 'Current plans, capture, MCP and monitoring', url: markerSources.pricing },
            { label: 'Session replay and recording limitations', url: markerSources.replay },
            { label: 'Integration marketplace', url: markerSources.integrations },
            { label: 'What stays linked in Marker.io', url: markerSources.handoff },
            { label: 'Screenshot annotations for website design feedback', url: markerSources.annotation, reviewed: editingReview }
        ]
    },
    usersnap: {
        name: 'Usersnap', reviewed: originalReview, kind: 'discovery', focus: 'Feedback → product discovery',
        bestFor: 'A product feedback program combining visual bug reports, video, satisfaction surveys and public request voting.',
        facts: {
            website: fact('yes', 'Annotated website feedback', 'Widget and browser extension capture routes.', usersnapSources.features),
            editing: fact('unknown', 'On-page edits not verified', 'Usersnap documents highlight, pen, arrow, comment and hide tools on a captured screenshot. On-page text and CSS previews are unverified.', usersnapSources.annotation),
            context: fact('yes', 'Screenshot and metadata', 'Annotation tools, browser context and attachments.', usersnapSources.features),
            recording: fact('limited', 'Video and optional audio', 'Up to three minutes. Not supported in mobile web browsers or desktop Safari; permission and a secure context are required.', usersnapSources.recording),
            replay: unverified(usersnapSources.features),
            diagnostics: fact('limited', 'Gated widget capture', 'JavaScript errors and XHR/Fetch requests. Not through extensions or on mobile; early errors may be missed.', usersnapSources.diagnostics),
            assets: unverified(usersnapSources.features),
            research: fact('yes', 'Surveys and voting boards', 'NPS, CSAT, polls, targeting and public requests. Boards and roadmaps depend on the plan.', usersnapSources.features),
            workflow: fact('yes', 'Feedback and opportunities', 'Organize feedback evidence and connect it to opportunities and external tools.', usersnapSources.integrations),
            confirmation: unverified(usersnapSources.features),
            mcp: fact('yes', 'Feedback and opportunities', 'Read evidence and create opportunities; company access must be enabled. Raw feedback editing and deletion are unavailable through MCP.', usersnapSources.mcp),
            checks: unverified(usersnapSources.features)
        },
        setup: 'Install a feedback widget or use a browser extension. Screen recording and native screenshot modes need browser permission and have browser-specific restrictions. Native mobile SDKs are a separate offering.',
        pricing: 'Paid plans with project, channel and seat entitlements. Public boards, diagnostics and other capabilities depend on the plan. Check the current matrix for your workflow.',
        pricingUrl: usersnapSources.pricing,
        integrations: 'Includes Jira, Slack, Zendesk and Salesforce. Opportunity status sync is documented for Jira, Azure DevOps and Asana; do not assume every integration syncs all feedback both ways.',
        integrationUrl: usersnapSources.integrations,
        sources: [
            { label: 'Visual feedback, surveys and voting', url: usersnapSources.features },
            { label: 'Recording support and restrictions', url: usersnapSources.recording },
            { label: 'Console and network recorder', url: usersnapSources.diagnostics },
            { label: 'Usersnap integrations', url: usersnapSources.integrations }, { label: 'Usersnap MCP', url: usersnapSources.mcp },
            { label: 'Plans and entitlements', url: usersnapSources.pricing },
            { label: 'Feedback with a screenshot', url: usersnapSources.annotation, reviewed: editingReview }
        ]
    },
    pastel: {
        name: 'Pastel', reviewed: originalReview, kind: 'proofing', focus: 'Website or asset → version approval',
        bestFor: 'Reviewing websites, PDFs, images, videos and marketing emails, with approval of an entire asset version.',
        facts: {
            website: fact('yes', 'Live website canvas', 'A proxy overlays comments on the live site. Website changes appear in the canvas.', pastelSources.website),
            editing: fact('limited', 'Text previews in a website canvas', 'Suggest replacement text, switch between Before and After on the canvas and copy the edited text. CSS previews are unverified.', pastelSources.editing),
            context: fact('yes', 'Screenshot and device details', 'Website comments retain browser and viewport context.', pastelSources.faq),
            recording: fact('unknown', 'Recording not verified', 'Uploaded-video proofing is supported, but it is a different capability from recording a bug reproduction.', pastelSources.faq),
            replay: unverified(pastelSources.faq),
            diagnostics: unverified(pastelSources.faq),
            assets: fact('yes', 'Multi-format canvases', 'PDFs, images, videos and marketing emails. The separate PDF/image guide explains position-based file pins.', pastelSources.faq),
            research: unverified(pastelSources.faq),
            workflow: fact('yes', 'Canvas organization', 'Assignments, labels, deadlines, folders and pausing comments.', pastelSources.pricing),
            confirmation: fact('yes', 'Asset-version approval', 'Approve or request changes per canvas version. New versions need a new decision; this differs from per-thread fix verification.', pastelSources.approvals),
            mcp: unverified(pastelSources.faq),
            checks: unverified(pastelSources.faq)
        },
        setup: 'Paste a website URL or upload an asset and share a canvas link. Reviewers need no software installation or account. Private-site guidance uses Browse mode to sign in; test your particular authentication setup.',
        pricing: 'Free includes one user and one canvas. Paid plans add capacity; Team includes project-management integrations and webhook export. Reviewers, comments and views are unlimited across plans.',
        pricingUrl: pastelSources.pricing,
        integrations: 'Team includes project-management integrations and webhooks. Listed destinations include Trello, Asana, Jira, ClickUp, Monday and Zapier.',
        integrationUrl: pastelSources.pricing,
        sources: [
            { label: 'Editing text in a canvas', url: pastelSources.editing, reviewed: editingReview },
            { label: 'Formats, reviewers and context', url: pastelSources.faq }, { label: 'Live websites and private-site access', url: pastelSources.website },
            { label: 'PDF and image review', url: pastelSources.files }, { label: 'Version approvals', url: pastelSources.approvals },
            { label: 'Plans and integrations', url: pastelSources.pricing }
        ]
    },
    userback: {
        name: 'Userback', reviewed: currentReview, kind: 'diagnostics', focus: 'In-app feedback → evidence and triage',
        bestFor: 'Product teams combining visual bug reports with replay, diagnostics, surveys and an agent-assisted feedback inbox.',
        facts: {
            website: fact('yes', 'Widget and extension reports', 'Collect screenshot annotations from a site widget or browser extension.', userbackSources.features),
            editing: fact('unknown', 'On-page edits not verified', 'Userback documents annotating screenshots with boxes, arrows, text and pinned comments. On-page text and CSS previews are unverified.', userbackSources.annotation),
            context: fact('yes', 'Visual and technical context', 'Screenshots and browser context accompany reports. Technical diagnostics have separate plan and capture requirements.', userbackSources.features),
            recording: fact('yes', 'Video feedback', 'Users can record a bug explanation. Video recording is separate from a reconstructed session replay.', userbackSources.recording),
            replay: fact('limited', 'Feedback and full-session replay', 'Feedback replay needs the installed widget and replay enabled. Full-session recording is a separate offering; iframes, audio, video and canvas are not replayed.', userbackSources.replay),
            diagnostics: fact('limited', 'Console and network evidence', 'Business lists developer tools and feedback replay. The replay view includes console logs and network requests.', userbackSources.pricing),
            assets: unverified(userbackSources.features),
            research: fact('limited', 'Surveys and feature portal', 'Surveys, voting and product-feedback collection are listed on Business and above.', userbackSources.pricing),
            workflow: fact('yes', 'Custom feedback workflows', 'Configure statuses, automation and privacy per site. Userback distinguishes site settings from feedback collection settings.', userbackSources.workflow),
            confirmation: unverified(userbackSources.features),
            mcp: fact('limited', 'OAuth and feedback tools', 'Read feedback and logs, comment, assign and update workflow through approved tool calls. OAuth follows existing workspace permissions; plan availability is covered below.', userbackSources.mcp),
            checks: unverified(userbackSources.features)
        },
        setup: 'Install a widget for in-app collection and feedback replay, or use the browser extension for visual reports. Replay requires site code and its own settings; an extension report alone does not establish replay coverage.',
        pricing: 'Free and paid tiers bundle sites and team seats. Free feedback remains available for seven days. MCP is listed from Team; diagnostics, feedback replay, surveys and project-management integrations from Business. Extra seats and full-session replay have separate terms.',
        pricingUrl: userbackSources.pricing,
        integrations: 'Project-management and customer-support integrations have different entitlements. The pricing page names two-way sync for Jira and ClickUp; do not assume every destination or attachment syncs both ways.',
        integrationUrl: userbackSources.integrations,
        sources: [
            { label: 'Visual collection and product feedback', url: userbackSources.features },
            { label: 'Video feedback', url: userbackSources.recording },
            { label: 'Replay setup, privacy and limitations', url: userbackSources.replay },
            { label: 'Workflow, automation and privacy', url: userbackSources.workflow },
            { label: 'Browser extension', url: userbackSources.setup },
            { label: 'Integrations', url: userbackSources.integrations },
            { label: 'MCP permissions and available tools', url: userbackSources.mcp },
            { label: 'Current plans and entitlements', url: userbackSources.pricing },
            { label: 'Screenshot annotation tools', url: userbackSources.annotation, reviewed: editingReview }
        ]
    },
    ruttl: {
        name: 'ruttl', reviewed: currentReview, kind: 'board', focus: 'Visual change → an assigned task',
        bestFor: 'Agency reviews that demonstrate CSS or copy changes in website projects, collect guest comments and include PDF or image feedback.',
        facts: {
            website: fact('yes', 'Pixel-pinned live-page comments', 'Create a website project from its URL and share a guest-commenting link without reviewer sign-up.', ruttlSources.comments),
            editing: {
                ...fact('yes', 'CSS and text in website projects', 'Demonstrate CSS and text changes on the page in a website project. The web application FAQ says edit mode is unavailable in web app projects.', ruttlSources.editing),
                additionalSource: { label: 'Web application FAQ', url: ruttlSources.webApps }
            },
            context: fact('limited', 'Page comments and device previews', 'Responsive previews are documented. Browser/OS metadata capture is not established by the sources checked.', ruttlSources.comments),
            recording: fact('limited', 'Video comments', 'The product page lists recordings as visual comments. Browser, audio and recording-length limits were not established by the sources checked.', ruttlSources.features),
            replay: unverified(ruttlSources.features),
            diagnostics: unverified(ruttlSources.features),
            assets: fact('yes', 'Image and PDF review', 'Position feedback on images and PDFs, assign tasks and tag collaborators. Format and storage entitlements depend on the plan.', ruttlSources.features),
            research: unverified(ruttlSources.features),
            workflow: fact('yes', 'Custom Kanban lists', 'Assign work, set priorities and deadlines, and organize comments in custom lists.', ruttlSources.comments),
            confirmation: unverified(ruttlSources.comments),
            mcp: fact('yes', 'Agent access to feedback', 'The MCP page documents reading and resolving feedback, with one-click Claude/Cursor setup and tokens for other clients. Resolution is not proof of human approval.', ruttlSources.mcp),
            checks: fact('unknown', 'Checks announced', 'Accessibility and SEO entries on the product page are marked coming soon. Current availability is not verified.', ruttlSources.features)
        },
        setup: 'Use a URL-based website project and a shareable guest link. Web-application review separately documents a script before the closing body tag. Test login-protected pages and the chosen mode; neither route guarantees every authentication or iframe setup works.',
        pricing: 'Free and paid tiers; the page labels billing per month per user. Cards and the detailed table differ on some free user/guest allowances, so confirm the applicable limits before choosing. Projects, pages, storage and integration access vary by plan.',
        pricingUrl: ruttlSources.pricing,
        integrations: 'The catalog includes Jira, Trello, Asana, Slack, ClickUp and Zapier. Verify the destination, plan and actual sync behavior; a catalog listing does not establish two-way thread or attachment synchronization.',
        integrationUrl: ruttlSources.integrations,
        sources: [
            { label: 'Live comments, guests and task organization', url: ruttlSources.comments },
            { label: 'Website project CSS and text demonstrations', url: ruttlSources.editing, reviewed: editingReview },
            { label: 'Web application edit mode FAQ', url: ruttlSources.webApps, reviewed: editingReview },
            { label: 'Images, PDFs, video and announced checks', url: ruttlSources.features },
            { label: 'Integration catalog', url: ruttlSources.integrations },
            { label: 'MCP setup and feedback actions', url: ruttlSources.mcp },
            { label: 'Current pricing and allowance caveats', url: ruttlSources.pricing }
        ]
    }
} satisfies Record<string, Product>;

export type CompetitorSlug = keyof typeof competitors;
export const competitorSlugs = Object.keys(competitors) as CompetitorSlug[];
export const comparisonSlugs = ['website-feedback-tools', ...competitorSlugs];
export function isCompetitorSlug(value: string): value is CompetitorSlug { return Object.hasOwn(competitors, value); }

export function comparisonMetadata(slug: string) {
    if (slug === 'website-feedback-tools') return {
        title: 'Website feedback tools compared',
        description: 'Compare uier, BugHerd, Marker.io, Usersnap, Pastel, Userback and ruttl by workflow, capture, editing, proofing, integrations and limitations.'
    };
    if (!isCompetitorSlug(slug)) return undefined;
    const product = competitors[slug];
    return {
        title: `${product.name} alternative: uier compared`,
        description: `uier vs ${product.name}: compare website feedback, capture, review workflows, integrations and pricing, including what uier does not support.`
    };
}

export const hubMetadata = {
    title: 'Website feedback comparisons and alternatives',
    description: 'Find a website feedback tool for client review, bug reporting or asset approval. Compare uier with BugHerd, Marker.io, Usersnap, Pastel, Userback and ruttl.'
};
