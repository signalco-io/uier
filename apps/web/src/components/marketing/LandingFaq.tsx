import type { ReactNode } from 'react';
import { brand } from '@uier/brand';
import { KnownPages } from '../../knownPages';
import { firefoxExtensionRelease } from '../../lib/extension/release';
import { InlineLink, Panel } from './ContentPage';

// Answers only what the product does today (the toolbar on uier.io, projects for your own sites in the
// app); see BRAND.md, "Tagline and voice".
// Native <details> disclosures: keyboard (Enter/Space) and screen readers work without script, and
// find-in-page searches the closed answers too.

export type Question = { question: string; answer: ReactNode };

const questions: Question[] = [
    {
        question: `What is ${brand.name}?`,
        answer: <>A way to review a live website on the page itself. A toolbar sits at the bottom of the page: pin a comment to an element, an area or selected text, reply in the thread and mark it done when it is fixed. Projects bring it to your own sites, with your team, review links, a board and page checks.</>
    },
    {
        question: `Can I use ${brand.name} on my own website?`,
        answer: <>Yes. Create a project in the <InlineLink href={KnownPages.App}>{brand.name} app</InlineLink>, add one script tag to your site and open a review link. You choose who can comment: the people you invite, or anyone with the link. Signed-in reviewers can also use the <InlineLink href={KnownPages.BrowserExtension}>browser extension</InlineLink> instead of the script.</>
    },
    {
        question: 'Does it work with my stack?',
        answer: <>If you can add a script tag to the page, yes. The install guide in the app has steps for HTML, Next.js, React, WordPress, Webflow and Shopify, and lists the sources to allow if your site sends a Content-Security-Policy. If you cannot change the site, project members and invited reviewers can review it in desktop Chrome or Edge with the <InlineLink href={KnownPages.BrowserExtension}>browser extension</InlineLink>. {firefoxExtensionRelease.availabilityMessage}</>
    },
    {
        question: 'How do I sort through a lot of feedback?',
        answer: <>In the app, search a project&rsquo;s feedback, filter it by status, priority, people, page or environment, and work through it as a list or on a board. Select up to 50 threads to assign them, set their priority, mark them as done or reopen them at once. <InlineLink href={KnownPages.FeedbackTriage}>Feedback triage</InlineLink> explains how it works and its limits.</>
    },
    {
        question: 'What do the accessibility and SEO checks look at?',
        answer: <>The Accessibility panel runs axe-core&rsquo;s WCAG A and AA rules and best practices, plus WCAG 2.2&rsquo;s target size. The SEO panel reads the title, description, canonical link, headings, links, images, sharing tags and structured data, and measures Core Web Vitals in your browser. Both check each page as you review it, and every finding can become a comment in one click. <InlineLink href={KnownPages.PageChecks}>Page checks</InlineLink> explains what they cover and what they cannot tell.</>
    },
    {
        question: 'Does it connect to my issue tracker?',
        answer: <>Yes, in a project. A workspace admin connects GitHub, Linear, Notion or Azure DevOps, and each shared thread becomes an issue, a page or a work item with its page context. Slack gets a message for each new thread. Private feedback stays in {brand.name}. <InlineLink href={KnownPages.Integrations}>Integrations</InlineLink> has the setup for each service.</>
    },
    {
        question: 'Can developers and AI agents use the feedback?',
        answer: <>Yes. Copy issue turns a thread into Markdown with the page, the anchor, the priority, the browser details and the discussion, to paste anywhere. AI agents connect through the MCP connector: Claude Code signs in through your browser, other tools use an access token from your account settings. An agent can show that it is working on a thread and link its pull request. Each connection is read-only unless you allow more, reaches only what you choose, and can be revoked at any time. <InlineLink href={KnownPages.Ai}>AI features</InlineLink> explains the setup and what an agent can do.</>
    },
    {
        question: 'Can the reviewer confirm that a fix works?',
        answer: <>Yes, in a project. When a fix is ready, a member requests verification and the reviewer chooses Confirm fix or Still needs work. Marking a thread done without it still works. <InlineLink href={KnownPages.FixVerification}>Fix verification</InlineLink> explains who can decide.</>
    },
    {
        question: 'Do I need an account?',
        answer: <>You can try this page as a guest without an account. A guest identity lets you manage your own feedback; authorized uier staff can moderate it. To review your own site you sign in with a code sent to your email, with Google or Microsoft, or with a passkey. There is no password. Project access settings determine whether reviewers must sign in.</>
    },
    {
        question: 'Who can see my comments?',
        answer: <>Guest feedback on our public pages is public, under a name such as &ldquo;Guest 3F2A&rdquo;. Signed-in feedback on uier is private to you and the uier team. On your own site the project decides who can review it; a private thread is visible only to its author and workspace admins.</>
    },
    {
        question: 'What is saved with a comment?',
        answer: <>The text, page, anchor and time, plus a screenshot when capture works. A screenshot can include visible sensitive content; omit it before posting or redact a saved image later. Later redaction cannot recall copies. Members can see available browser, operating-system and device context; public and guest views show only coarse device and window sizes. A requested rewrite sends the selected text, your instruction and configured style guidance to Anthropic. The <InlineLink href={KnownPages.LegalPrivacyPolicy}>privacy policy</InlineLink> has the details.</>
    },
    {
        question: 'How long are comments kept?',
        answer: <>Feedback in uier&rsquo;s own feedback projects expires 90 days after its last change, including signed-in feedback; our starter threads and their replies do not expire. Feedback in customer projects stays until deleted. Removing one message can preserve other people&rsquo;s replies; a separate authorized whole-thread deletion removes the discussion. Done and Archive keep the feedback.</>
    },
    {
        question: 'What does it cost?',
        answer: <>Nothing. {brand.pricing}</>
    },
    {
        question: `Is ${brand.name} open source?`,
        answer: <>Yes. The website, the toolbar and the infrastructure are on GitHub. <InlineLink href={KnownPages.OpenSource}>Open source</InlineLink> explains the licenses.</>
    },
    {
        question: 'Does it work with a keyboard?',
        answer: <>Yes. Press C to start a comment and ? to list the other shortcuts; you can turn them off in the toolbar&rsquo;s options. Or focus an element on the page, Tab to + in the toolbar and press Enter to comment on that element. The app has shortcuts of its own, and new comments and replies are announced to screen readers.</>
    }
];

export function LandingFaq() {
    return <FaqPanel questions={questions} />;
}

/** Questions as disclosures in one panel: the landing's and a feature page's own */
export function FaqPanel({ questions }: { questions: Question[] }) {
    return (
        <Panel>
            {questions.map(item => (
                <details key={item.question} className="group px-6">
                    {/* The margin keeps the focus ring (2px at 2px offset) inside the panel, which clips its cells */}
                    <summary className="my-2 flex cursor-pointer list-none items-center justify-between gap-4 rounded-md py-3 text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background [&::-webkit-details-marker]:hidden">
                        {item.question}
                        {/* A plus that turns into a close mark when the answer is open */}
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-open:rotate-45 motion-reduce:transition-none"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                    </summary>
                    <p className="pb-6 pr-8 text-base leading-relaxed text-muted-foreground">{item.answer}</p>
                </details>
            ))}
        </Panel>
    );
}
