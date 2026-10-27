import type { ReactNode } from 'react';
import { brand } from '@uier/brand';
import { KnownPages } from '../../knownPages';
import { InlineLink, Panel } from './ContentPage';

// Answers only what the product does today (the toolbar on uier.io, projects for your own sites in the
// app); see BRAND.md, "Tagline and voice".
// Native <details> disclosures: keyboard (Enter/Space) and screen readers work without script, and
// find-in-page searches the closed answers too.

const questions: { question: string; answer: ReactNode }[] = [
    {
        question: `What is ${brand.name}?`,
        answer: <>A way to review a live website on the page itself. A toolbar sits at the bottom of the page: pin a comment to an element or to selected text, reply in the thread and resolve it when it is done. Projects bring it to your own sites, with your team and review links.</>
    },
    {
        question: `Can I use ${brand.name} on my own website?`,
        answer: <>Yes. Create a project in the <InlineLink href={KnownPages.App}>{brand.name} app</InlineLink>, add one script tag to your site and open a review link. You choose who can comment: the people you invite, or anyone with the link.</>
    },
    {
        question: 'Does it work with my stack?',
        answer: <>If you can add a script tag to the page, yes. The install guide in the app has steps for HTML, Next.js, React, WordPress, Webflow and Shopify, and lists the sources to allow if your site sends a Content-Security-Policy.</>
    },
    {
        question: 'Can developers and AI agents use the feedback?',
        answer: <>Yes. Copy issue turns a thread into Markdown with the page, the anchor, the browser details and the discussion, to paste into your issue tracker. AI agents connect through the MCP connector with credentials you create in your account settings: read-only unless you allow more, limited to the projects you pick, and valid for 30 days.</>
    },
    {
        question: 'Do I need an account?',
        answer: <>Not on this page: here you comment as a guest. Your first comment sets a cookie that lets you resolve and delete your own comments, and only yours. To review your own site you sign in with your email; there is no password.</>
    },
    {
        question: 'Who can see my comments?',
        answer: <>On this page, everyone who opens it: comments here are public. You show up as a guest name such as &ldquo;Guest 3F2A&rdquo;. Do not post personal information. On your own site the project decides: only the people you invite, or anyone with the review link.</>
    },
    {
        question: 'What is saved with a comment?',
        answer: <>The text, the page and where on it the comment is pinned, the time, and the device it came from: its size, window size, browser and operating system. The <InlineLink href={KnownPages.LegalPrivacyPolicy}>privacy policy</InlineLink> has the details.</>
    },
    {
        question: 'How long are comments kept?',
        answer: <>Visitor threads on this site: 90 days after their last change, then they are deleted automatically. Our starter threads and their replies do not expire. Comments in your projects stay until you delete them. You can delete your own comments at any time.</>
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
        answer: <>Yes. Focus an element on the page, Tab to + in the toolbar and press Enter to comment on that element. New comments and replies are announced to screen readers.</>
    }
];

export function LandingFaq() {
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
