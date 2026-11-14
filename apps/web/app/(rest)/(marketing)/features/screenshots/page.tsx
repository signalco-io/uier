import { publicPageMetadata } from '@/src/lib/metadata';
import { Button } from '@signalco/ui-primitives/Button';
import { brand } from '@uier/brand';
import { CheckList, InlineLink, NumberedList, PageHeader, PageSection, Panel, StepsPanel, Tile } from '../../../../../src/components/marketing/ContentPage';
import { FaqPanel, type Question } from '../../../../../src/components/marketing/LandingFaq';
import { ScreenshotsCover } from '../../../../../src/components/marketing/covers/ScreenshotsCover';
import { KnownPages } from '../../../../../src/knownPages';

// What comes with a comment besides its text, as it ships: the automatic screenshot, the Attach
// screenshot toggle and Attach image (packages/toolbar/docs/screenshots.md, docs/review-workflow.md
// "Screenshots"), screen recordings (recordings.md, "Screen recordings"), the device details and who sees
// them (device-details.md, docs/api.md), and replacing and redacting saved images. Change this page with
// them. Capture is an attempt, never a guarantee, and redaction cannot recall copies already made.

const title = 'Screenshots and browser context';
const description = 'Each new comment attempts a screenshot of the spot. Members see the browser, system and screen it was left from, and private details can be covered.';

export const metadata = publicPageMetadata(KnownPages.Screenshots, { title, description });

const steps = [
    {
        title: 'Start a comment',
        text: 'As you pin a comment, the toolbar takes a screenshot of that part of the page in your browser, without the toolbar. Feedback about the whole page takes the visible window.'
    },
    {
        title: 'Choose what is sent',
        text: 'Attach screenshot in the text box says whether the screenshot will be sent. Turn it off when the spot shows something private, or attach an image of your own instead.'
    },
    {
        title: 'Post',
        text: 'The screenshot is saved with the comment and shows as a thumbnail in the thread. Click or tap it to see it full size.'
    }
];

const details = [
    { title: 'Screen', text: 'Phone, tablet or desktop, the window’s size and the pixel ratio.' },
    { title: 'Browser and system', text: 'Their names and versions, each with its mark, read in the reviewer’s browser.' },
    { title: 'Settings', text: 'Touch or mouse, light or dark, reduced motion and the page’s language.' },
    { title: 'Copy reproduction details', text: 'All of it as text, with the reviewed page and the time, to paste into an issue.' }
];

const evidence = [
    <><strong className="font-medium text-foreground">Record screen</strong> records a tab, a window or the screen for up to 60 seconds, without sound. You see the clip before you send it.</>,
    <><strong className="font-medium text-foreground">Upload recording</strong> attaches an MP4 or WebM video of up to 60 seconds and 25 MiB.</>,
    <><strong className="font-medium text-foreground">Attach image</strong> sends your own image instead of the screenshot. Pasting an image into the comment does the same.</>,
    <><strong className="font-medium text-foreground">Replies</strong> can carry an image and a recording of their own.</>
];

const privacy = [
    'Redact screenshot covers parts of a saved screenshot with opaque boxes, drawn with a mouse, a finger or the keyboard. Saving replaces the image.',
    'The author or a workspace admin can also upload or paste a new image in place of the screenshot.',
    'A replaced or redacted image cannot recall copies someone already downloaded.',
    'Screenshots and recordings are kept in private storage and shown only to people who can read the thread. They are deleted with the comment.'
];

const limits = [
    'Images, fonts and styles from other sites that do not allow it can come out empty or plain.',
    'Images that have not loaded within a second, canvas drawings, video, frames and backdrop blur do not show.',
    'When a screenshot cannot be taken, the text box says so and only the text is sent.'
];

const tryIt = [
    'Press + in the toolbar at the bottom of this window and click anything on this page.',
    'Write a comment and press Enter. The screenshot is saved with it.',
    'Open its pin to see the screenshot in the thread. Guest comments on this page are public, so leave out personal information.'
];

const questions: Question[] = [
    {
        question: 'Who sees the browser and device details?',
        answer: <>Project members. Guests and public viewers see only whether it was a phone, a tablet or a desktop and the window&rsquo;s size. The browser and system are named in the reviewer&rsquo;s browser: the user-agent string and the IP address are never stored with a comment.</>
    },
    {
        question: 'Can I see the screenshot before I post?',
        answer: <>No. There is no preview in the comment form: what the screenshot takes is the part of the page you pointed at, as you see it. Turn Attach screenshot off if it shows something private, or redact the saved screenshot afterwards.</>
    },
    {
        question: 'Does Record screen record sound?',
        answer: <>No. It records video only, and your browser asks each time which tab, window or screen to share. Leaving or reloading the page ends a recording that was not sent.</>
    },
    {
        question: 'Does every comment get a screenshot?',
        answer: <>New comments, feedback and bug reports start one. Replies do not; they can attach an image instead. A screenshot can also fail, or be turned off for one comment.</>
    },
    {
        question: 'Can a screenshot include private details?',
        answer: <>Yes, whatever is visible in that part of the page. Leave it out before posting, or redact the saved image later. The <InlineLink href={KnownPages.LegalPrivacyPolicy}>privacy policy</InlineLink> has the details.</>
    },
    {
        question: 'What does it cost?',
        answer: <>Nothing. {brand.pricing}</>
    }
];

export default function ScreenshotsPage() {
    return (
        <main className="flex flex-col pb-16">
            <PageHeader
                title="The context comes with the comment"
                lead="A new comment attempts a screenshot of the spot it is about. Project members also see the browser, system and screen it was left from, so the problem can be found again.">
                <div className="flex flex-wrap items-center gap-2.5">
                    <Button variant="solid" size="lg" href={KnownPages.App}>Get started</Button>
                    <Button variant="outlined" size="lg" href="#how-it-works">How it works</Button>
                </div>
            </PageHeader>
            <ScreenshotsCover />

            <PageSection
                id="how-it-works"
                title="How it works"
                lead="Nothing to press: the screenshot starts with the comment.">
                <StepsPanel steps={steps} />
            </PageSection>

            <PageSection
                id="device-details"
                title="Browser and device details"
                lead="Two icons after the comment’s time show the screen size and the browser. Hover or click them for the rest.">
                <Panel className="md:grid-cols-2">
                    {details.map(item => (
                        <Tile key={item.title} title={item.title}>
                            <p>{item.text}</p>
                        </Tile>
                    ))}
                </Panel>
            </PageSection>

            <PageSection
                id="recordings-and-images"
                title="Recordings and your own images"
                lead="Some problems only show when something moves. Attach in the text box adds a clip or an image.">
                <CheckList items={evidence} />
            </PageSection>

            <PageSection
                id="private-details"
                title="Private details"
                lead="A screenshot shows what was on the screen. Cover what should not be in it.">
                <CheckList items={privacy} />
            </PageSection>

            <PageSection
                id="limits"
                title="What a screenshot can miss"
                lead="The screenshot is drawn from the page in your browser, so some content cannot be copied.">
                <CheckList items={limits} />
            </PageSection>

            <PageSection
                id="try-it"
                title="Try it"
                lead="The toolbar at the bottom of this window works on this page, without an account.">
                <NumberedList items={tryIt} />
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
