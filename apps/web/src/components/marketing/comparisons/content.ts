import { brand } from '@uier/brand';
import type { WorkflowKind } from './WorkflowPicture';

export const checkedOn = '2026-11-11';
export const checkedOnLabel = '11 November 2026';
export type Support = 'yes' | 'limited' | 'no' | 'unknown';
export type Fact = { support: Support; label: string; detail: string; source?: string };
export const dimensions = [
    { id: 'website', name: 'Comments on a live website' },
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
    kind: WorkflowKind;
    focus: string;
    bestFor: string;
    facts: Record<Dimension, Fact>;
    setup: string;
    pricing: string;
    pricingUrl: string;
    integrations: string;
    integrationUrl: string;
    sources: { label: string; url: string }[];
};

const fact = (support: Support, label: string, detail: string, source?: string): Fact => ({ support, label, detail, source });
const unverified = (source: string) => fact('unknown', 'Not verified', 'The sources checked do not establish support or absence.', source);

export const uier: Product = {
    name: brand.name, kind: 'review', focus: 'Live-page review → a checked fix',
    bestFor: 'Review a live site, assign the feedback and ask a named reviewer to check the fix.',
    facts: {
        website: fact('yes', 'Element, text and area pins', 'Review the actual page with the toolbar.', '/#features'),
        context: fact('yes', 'Screenshot and device details', 'Page address, browser, OS and viewport accompany feedback.', '/#features'),
        recording: fact('limited', 'Short screen recordings', 'Attach a recording up to 60 seconds and 25 MiB. Browser capture needs permission and a secure context; upload MP4 or WebM when capture is unavailable. Built-in capture has no audio and ends on full-page navigation.', `${brand.repository}/blob/main/docs/recordings.md`),
        replay: fact('no', 'Not supported', 'No timeline of what happened before a report.'),
        diagnostics: fact('no', 'Not supported', 'Browser details are captured; console logs and network requests are not.'),
        assets: fact('no', 'No file proofing', 'Images can accompany a thread. There are no PDF, design-file, video or email review canvases.'),
        research: fact('no', 'Not supported', 'No NPS or CSAT surveys, public voting board or product roadmap.'),
        workflow: fact('limited', 'List and fixed-status board', 'Assignment, priority and bulk triage; no custom statuses. Up to 1,000 recent threads per project and 50 per bulk action.', '/features/feedback-triage'),
        confirmation: fact('yes', 'Named reviewer per thread', 'Confirm fix or Still needs work. Ordinary Done is separate; this is not release or asset-version approval.', '/features/fix-verification'),
        mcp: fact('yes', 'Read and approved actions', 'Coding tools can work with feedback. An agent cannot confirm a fix.', '/features/ai'),
        checks: fact('limited', 'In-browser page checks', 'Accessibility and SEO checks on reviewed pages; no site-wide scheduled crawler or compliance certification.', '/features/page-checks')
    },
    setup: 'Create a project and use the script, a review link or the desktop extension. Guest commenting depends on the project’s access settings. Test the chosen route on your site, including its login and content security policy.',
    pricing: brand.pricing, pricingUrl: '/#pricing',
    integrations: 'GitHub, Linear, Azure DevOps, Notion and Slack. Each project chooses a destination and optional sync behavior; capabilities differ by provider.',
    integrationUrl: '/integrations',
    sources: [
        { label: 'uier review workflow and limits', url: `${brand.repository}/blob/main/docs/review-workflow.md` },
        { label: 'uier capture and device context', url: `${brand.repository}/blob/main/packages/toolbar/src/feedbackContext.ts` },
        { label: 'uier recording scope and limits', url: `${brand.repository}/blob/main/docs/recordings.md` },
        { label: 'uier features and pricing', url: '/#features' }
    ]
};

const bugherdSources = {
    features: 'https://bugherd.com/features', pricing: 'https://bugherd.com/pricing',
    video: 'https://bugherd.com/video-feedback-tool', board: 'https://bugherd.com/use-case/website-qa-tool',
    mcp: 'https://bugherd.com/feature/mcp',
    setup: 'https://support.bugherd.com/en/articles/11424313-get-feedback-from-clients-on-websites-and-files'
};
const markerSources = {
    pricing: 'https://marker.io/pricing', integrations: 'https://marker.io/integrations',
    replay: 'https://help.marker.io/en/articles/6673880-session-replay-videos',
    handoff: 'https://help.marker.io/en/articles/14430683-why-are-console-logs-network-requests-and-replays-linked-instead-of-attached'
};
const usersnapSources = {
    features: 'https://usersnap.com/features', pricing: 'https://usersnap.com/pricing', integrations: 'https://usersnap.com/integrations',
    recording: 'https://help.usersnap.com/docs/feedback-with-a-screen-recording',
    diagnostics: 'https://help.usersnap.com/docs/console-recorder-feature', mcp: 'https://usersnap.com/integrations/mcp'
};
const pastelSources = {
    faq: 'https://usepastel.com/faq', pricing: 'https://usepastel.com/plans',
    website: 'https://help.usepastel.com/en/articles/1996011-reviewing-websites-in-pastel',
    files: 'https://help.usepastel.com/en/articles/5395323-review-pdfs-and-image-files-in-pastel',
    approvals: 'https://usepastel.com/blog/approvals'
};

export const competitors = {
    bugherd: {
        name: 'BugHerd', kind: 'board', focus: 'Visual reports → a custom task board',
        bestFor: 'Website and design feedback that needs recorded explanations and a customizable Kanban workflow.',
        facts: {
            website: fact('yes', 'Element-pinned feedback', 'Website comments and suggested text replacements.', bugherdSources.features),
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
            { label: 'Client access and setup', url: bugherdSources.setup }, { label: 'MCP', url: bugherdSources.mcp }
        ]
    },
    'marker-io': {
        name: 'Marker.io', kind: 'diagnostics', focus: 'Bug report → reproduction evidence',
        bestFor: 'Developer bug reports that need session replay, console and network evidence, or a wider choice of issue trackers.',
        facts: {
            website: fact('yes', 'Visual website reports', 'Annotated screenshots with an embedded widget or extension.', markerSources.pricing),
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
            { label: 'What stays linked in Marker.io', url: markerSources.handoff }
        ]
    },
    usersnap: {
        name: 'Usersnap', kind: 'discovery', focus: 'Feedback → product discovery',
        bestFor: 'A product feedback program combining visual bug reports, video, satisfaction surveys and public request voting.',
        facts: {
            website: fact('yes', 'Annotated website feedback', 'Widget and browser extension capture routes.', usersnapSources.features),
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
            { label: 'Integrations', url: usersnapSources.integrations }, { label: 'MCP', url: usersnapSources.mcp },
            { label: 'Plans and entitlements', url: usersnapSources.pricing }
        ]
    },
    pastel: {
        name: 'Pastel', kind: 'proofing', focus: 'Website or asset → version approval',
        bestFor: 'Reviewing websites, PDFs, images, videos and marketing emails, with approval of an entire asset version.',
        facts: {
            website: fact('yes', 'Live website canvas', 'A proxy overlays comments on the live site. Website changes appear in the canvas.', pastelSources.website),
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
            { label: 'Formats, reviewers and context', url: pastelSources.faq }, { label: 'Live websites and private-site access', url: pastelSources.website },
            { label: 'PDF and image review', url: pastelSources.files }, { label: 'Version approvals', url: pastelSources.approvals },
            { label: 'Plans and integrations', url: pastelSources.pricing }
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
        description: 'Compare uier, BugHerd, Marker.io, Usersnap and Pastel by actual workflow, capture, proofing, integrations and limitations.'
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
    description: 'Find a website feedback tool for client review, bug reporting or asset approval. Visual comparisons of uier, BugHerd, Marker.io, Usersnap and Pastel.'
};
