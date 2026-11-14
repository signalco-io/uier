import { publicPageMetadata } from '@/src/lib/metadata';
import { Button } from '@signalco/ui-primitives/Button';
import { brand } from '@uier/brand';
import { CheckList, InlineLink, NumberedList, PageHeader, PageSection, Panel, StepsPanel, Tile } from '../../../../../src/components/marketing/ContentPage';
import { FaqPanel, type Question } from '../../../../../src/components/marketing/LandingFaq';
import { PinnedCover } from '../../../../../src/components/marketing/covers/PinnedCover';
import { KnownPages } from '../../../../../src/knownPages';

// Pinning a comment to an element, a dragged area or selected words, and what keeps a pin on its spot,
// as the toolbar ships it: packages/toolbar/docs/point-mode.md (point mode, areas, selected text),
// comment-thread.md (the pin), canvas-mode.md (Draw on the page, the optional `draw` feature),
// anchor-recovery.md and docs/review-workflow.md ("Missing anchors and reattachment"). Change this page
// with them. Never claim a pin is moved by guessing: missing and ambiguous anchors get no pin.

const title = 'Pinned comments';
const description = `Pin feedback to an element, an area or a few words on a live website. Each pin stays on its spot when the page scrolls, resizes or reloads.`;

export const metadata = publicPageMetadata(KnownPages.PinnedComments, { title, description });

const steps = [
    {
        title: 'Point at it',
        text: 'Press + in the toolbar, or C, then click or tap the element the comment is about. With a keyboard, focus the element on the page, Tab to + and press Enter.'
    },
    {
        title: 'Or drag an area',
        text: 'With a mouse or a pen, drag over part of the page instead. The comment covers all of it, and its pin sits at the area’s bottom-right corner.'
    },
    {
        title: 'Or select the words',
        text: 'Select text on the page and choose Add comment. The words keep a blue tint, so everyone sees which ones the comment is about.'
    },
    {
        title: 'Write and post',
        text: 'Press Enter to post. The pin shows the thread’s number, the same one the inbox and the app show.'
    }
];

const pin = [
    { title: 'One number everywhere', text: 'A pin shows its thread’s number, like #12. Mention it in a meeting and anyone can find it in the inbox or the app.' },
    { title: 'Replies and status on the pin', text: 'From the first reply a badge counts the messages. Once a thread is in progress or ready to verify, a dot in its status’s colour shows on the pin.' },
    { title: 'A preview on hover', text: 'Rest the mouse on a pin to read the thread without opening it. Click or tap it to reply.' },
    { title: 'Done leaves the page', text: 'When a thread is done its pin goes away, so the page shows only what is still open. The thread stays in the inbox under Done.' }
];

const changes = [
    'Pins follow their element when the page scrolls, resizes or reloads.',
    'A comment in an open menu, popover or dialog remembers what opened it. While that layer is closed, the pin waits on the button that opens it.',
    'Text that has moved is found again by its words. When the words match more than one place, no place is guessed.',
    'When the element is gone or matches more than once, the thread gets no pin and stays in the inbox, where its details say what happened.',
    'After a redesign, the author or a workspace admin can reattach the comment to the new element, area or words. The messages, screenshot and status stay as they were.'
];

const draw = [
    'Draw on the page, next to Add comment in the toolbar, opens the drawing tools: pen, marker, brush, lines, arrows, shapes, text notes and blur.',
    'Everything drawn in one go becomes one comment on the area around it. The drawing shows where it was drawn and is painted into the comment’s screenshot.',
    'Lines, arrows, shapes and notes can be added, moved and resized from the keyboard too.',
    'Project admins can hide Draw on the page in the project’s settings. Saved drawings still show.'
];

const tryIt = [
    'Press + in the toolbar at the bottom of this window, then click or tap anything on this page.',
    'Or drag over an area, or select a few words and choose Add comment.',
    'Write, then press Enter. Guest comments on this page are public, so leave out personal information.'
];

const questions: Question[] = [
    {
        question: 'Does it work on any website?',
        answer: <>On your own sites, once a project&rsquo;s script tag is on the page. Where you cannot change the site, project members and invited reviewers can use the <InlineLink href={KnownPages.BrowserExtension}>browser extension</InlineLink> instead. The toolbar at the bottom of this page works on {brand.name}&rsquo;s own pages.</>
    },
    {
        question: 'Does it work on a phone?',
        answer: <>Yes. Tap + and then the element, or select words and choose Add comment. Dragging an area needs a mouse or a pen.</>
    },
    {
        question: 'What happens when the page changes?',
        answer: <>Pins follow their element as long as it can be found. When it cannot, {brand.name} does not guess: the thread has no pin, stays in the inbox and says what happened, and the author or an admin can reattach it.</>
    },
    {
        question: 'Can I comment on something inside a menu or a dialog?',
        answer: <>Yes. Open it and comment as usual. The comment remembers the button that opened it, so when the menu is closed its pin waits on that button.</>
    },
    {
        question: 'What else is saved with the comment?',
        answer: <>A screenshot of the spot when capture works, and for members the browser and screen it was left from. <InlineLink href={KnownPages.Screenshots}>Screenshots and context</InlineLink> explains what is captured and how to cover private details.</>
    },
    {
        question: 'What does it cost?',
        answer: <>Nothing. {brand.pricing}</>
    }
];

export default function PinnedCommentsPage() {
    return (
        <main className="flex flex-col pb-16">
            <PageHeader
                title="Pin each comment to what it is about"
                lead="Click an element, drag over an area or select a few words on the live page, and write. The comment stays pinned to that spot, so nobody has to describe where it is.">
                <div className="flex flex-wrap items-center gap-2.5">
                    <Button variant="solid" size="lg" href={KnownPages.App}>Get started</Button>
                    <Button variant="outlined" size="lg" href="#how-it-works">How it works</Button>
                </div>
            </PageHeader>
            <PinnedCover />

            <PageSection
                id="how-it-works"
                title="How it works"
                lead="Three ways to say where, then the comment itself.">
                <StepsPanel steps={steps} />
            </PageSection>

            <PageSection
                id="the-pin"
                title="The pin"
                lead="Its sharp corner points at the spot, and it shows what is going on in the thread.">
                <Panel className="md:grid-cols-2">
                    {pin.map(item => (
                        <Tile key={item.title} title={item.title}>
                            <p>{item.text}</p>
                        </Tile>
                    ))}
                </Panel>
            </PageSection>

            <PageSection
                id="when-the-page-changes"
                title="When the page changes"
                lead="A live site changes while it is reviewed. Pins stay with what they are about, and are never moved by guesswork.">
                <CheckList items={changes} />
            </PageSection>

            <PageSection
                id="draw"
                title="Draw on the page"
                lead="When words are not enough, circle it, point an arrow at it or blur it.">
                <CheckList items={draw} />
            </PageSection>

            <PageSection
                id="try-it"
                title="Try it"
                lead="The toolbar at the bottom of this window works on this page, without an account.">
                <NumberedList items={tryIt} />
                <p className="max-w-[720px] text-sm text-muted-foreground">
                    For your own site, <InlineLink href={KnownPages.App}>create a project</InlineLink> and add its script tag.
                </p>
            </PageSection>

            <PageSection
                id="faq"
                title="Questions"
                lead={<>More about {brand.name} in the <InlineLink href={KnownPages.Faq}>main questions</InlineLink>.</>}>
                <FaqPanel questions={questions} />
            </PageSection>
        </main>
    );
}
