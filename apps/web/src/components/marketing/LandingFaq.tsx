import type { ReactNode } from 'react';
import { brand } from '@uier/brand';
import { KnownPages } from '../../knownPages';
import { InlineLink } from './ContentPage';

// Answers only what the product does today (the toolbar on uier.io); see BRAND.md, "Tagline and voice".
// Native <details> disclosures: keyboard (Enter/Space) and screen readers work without script, and
// find-in-page searches the closed answers too.

const questions: { question: string; answer: ReactNode }[] = [
    {
        question: `What is ${brand.name}?`,
        answer: <>A way to review a live website on the page itself. A toolbar sits at the bottom of the page: pin a comment to an element or to selected text, reply in the thread and resolve it when it is done.</>
    },
    {
        question: `Can I use ${brand.name} on my own website?`,
        answer: <>Not yet. Today {brand.name} runs on {brand.domain}, so you can try everything it does on this page. Support for your own sites is being built in the open on <InlineLink href={brand.repository}>GitHub</InlineLink>.</>
    },
    {
        question: 'Do I need an account?',
        answer: <>No. You comment as a guest. Your first comment sets a cookie that lets you resolve and delete your own comments, and only yours.</>
    },
    {
        question: 'Who can see my comments?',
        answer: <>Everyone who opens the page: comments here are public. You show up as a guest name such as &ldquo;Guest 3F2A&rdquo;. Do not post personal information.</>
    },
    {
        question: 'What is saved with a comment?',
        answer: <>The text, the page and where on it the comment is pinned, the time, and the device it came from: its size, window size, browser and operating system. The <InlineLink href={KnownPages.LegalPrivacyPolicy}>privacy policy</InlineLink> has the details.</>
    },
    {
        question: 'How long are comments kept?',
        answer: <>90 days after their last change, then they are deleted automatically. You can delete your own comments at any time.</>
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
        <div className="flex max-w-[720px] flex-col border-b">
            {questions.map(item => (
                <details key={item.question} className="group border-t">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md py-4 text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background [&::-webkit-details-marker]:hidden">
                        {item.question}
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-open:-scale-y-100 motion-reduce:transition-none"><path d="m6 9 6 6 6-6" /></svg>
                    </summary>
                    <p className="pb-5 pr-8 text-base leading-relaxed text-muted-foreground">{item.answer}</p>
                </details>
            ))}
        </div>
    );
}
