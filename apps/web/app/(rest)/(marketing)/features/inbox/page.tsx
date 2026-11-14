import { publicPageMetadata } from '@/src/lib/metadata';
import { Button } from '@signalco/ui-primitives/Button';
import { brand } from '@uier/brand';
import { CheckList, InlineLink, NumberedList, PageHeader, PageSection, Panel, StepsPanel, Tile } from '../../../../../src/components/marketing/ContentPage';
import { FaqPanel, type Question } from '../../../../../src/components/marketing/LandingFaq';
import { InboxCover } from '../../../../../src/components/marketing/covers/InboxCover';
import { KnownPages } from '../../../../../src/knownPages';

// The toolbar's inbox as it ships (packages/toolbar/docs/inbox.md: the title row and search, the location
// picker with environments, pages and sections, Assigned to me, the unread line and Mark all as read, the
// Active, Done and All tabs, drafts, the paged list), environments (docs/review-workflow.md "Feedback
// environments"), unread state shared with the app ("Unread review activity") and the app's comments and
// My work (apps/web/docs/comments-inbox.md, app-shell.md). Change this page with them.

const title = 'Website feedback inbox';
const description = 'Every thread on the page and the rest of the site in the toolbar’s inbox. Search, pick a page or an environment, and see what is unread or assigned to you.';

export const metadata = publicPageMetadata(KnownPages.Inbox, { title, description });

const steps = [
    {
        title: 'Open the inbox',
        text: 'Inbox in the toolbar opens it beside the page. Its badge counts the threads you have not read, on every page of the site.'
    },
    {
        title: 'Pick where',
        text: 'It starts on this page. The location picker switches to all pages, a section such as /blog, another page or an environment, each with how many threads it has.'
    },
    {
        title: 'Narrow it down',
        text: 'Search the threads, show only what is assigned to you or unread, and switch between Active, Done and All. Active can narrow to Open, In progress or Ready to verify.'
    },
    {
        title: 'Read and reply',
        text: 'Each thread opens in the inbox with its messages and a reply box. Show on page takes you to a pin on this page; a thread from another page links to it.'
    }
];

const environments = [
    'Each comment knows the site address it was left on, such as staging or production. Pins show only the comments of the address you are on.',
    'The inbox can show every environment, or one, and remembers the choice on that site.',
    'Project admins label each address and choose which ones share feedback, such as example.com and www.example.com.',
    'Opening a comment’s link always takes you to the address it was left on.'
];

const extras = [
    { title: 'Unread', text: 'A thread you open is marked read after a moment on screen. Mark all as read clears what the filters show, and Mark as unread brings a thread back.' },
    { title: 'Drafts', text: 'Comments you started on this page and did not send wait at the top of the inbox, to finish, post or discard.' },
    { title: 'Long lists', text: 'The inbox loads 200 threads at a time as you scroll, and draws only the ones in view, so a busy site stays quick.' },
    { title: 'In the app', text: 'A project’s comments in the app have the same filters, in a list or on a board. My work collects what is assigned to you, what mentions you and what is unread, across projects.' }
];

const tryIt = [
    'Open Inbox in the toolbar at the bottom of this window.',
    'It lists the threads on this page. Choose All pages to see the ones on uier’s other public pages too.',
    'Open a thread to read it, reply, or go to its pin.'
];

const questions: Question[] = [
    {
        question: 'Is read and unread shared with the app?',
        answer: <>Yes. A member&rsquo;s read state is the same in the toolbar and the app, and emails about threads you have already read are not sent.</>
    },
    {
        question: 'Can guests use the inbox?',
        answer: <>Yes. Guests see the threads they can read on the project, as on this page, without an account.</>
    },
    {
        question: 'Does it show threads whose element is gone?',
        answer: <>Yes. A thread whose element was removed or changed has no pin on the page but stays in the inbox, where you can read it and reply, and its author or an admin can reattach it. <InlineLink href={KnownPages.PinnedComments}>Pinned comments</InlineLink> explains how pins follow the page.</>
    },
    {
        question: 'How do I move the inbox out of the way?',
        answer: <>It docks to a side of the window, beside the page. Move it to another side, or move the toolbar itself; both remember where you put them. Close puts the inbox away until you open it again.</>
    },
    {
        question: 'What does it cost?',
        answer: <>Nothing. {brand.pricing}</>
    }
];

export default function InboxPage() {
    return (
        <main className="flex flex-col pb-16">
            <PageHeader
                title="Every thread on the site, in one inbox"
                lead="The inbox in the toolbar lists the threads on this page and on the rest of the site. Search them, pick a page or an environment such as staging, and see what is unread or assigned to you.">
                <div className="flex flex-wrap items-center gap-2.5">
                    <Button variant="solid" size="lg" href={KnownPages.App}>Get started</Button>
                    <Button variant="outlined" size="lg" href="#how-it-works">How it works</Button>
                </div>
            </PageHeader>
            <InboxCover />

            <PageSection
                id="how-it-works"
                title="How it works"
                lead="The inbox sits beside the page you are reviewing, so you never leave the site to catch up.">
                <StepsPanel steps={steps} />
            </PageSection>

            <PageSection
                id="environments"
                title="Staging and production apart"
                lead="Review a staging site and the live one in the same project, without mixing their feedback.">
                <CheckList items={environments} />
            </PageSection>

            <PageSection
                id="more"
                title="And the rest"
                lead="The details that keep a long review manageable.">
                <Panel className="md:grid-cols-2">
                    {extras.map(item => (
                        <Tile key={item.title} title={item.title}>
                            <p>{item.text}</p>
                        </Tile>
                    ))}
                </Panel>
                <p className="max-w-[720px] text-sm text-muted-foreground">
                    Working through a lot of feedback? <InlineLink href={KnownPages.FeedbackTriage}>Feedback triage</InlineLink> covers search, priority and bulk changes in the app, and <InlineLink href={KnownPages.Board}>statuses and the board</InlineLink> how a thread goes from open to done.
                </p>
            </PageSection>

            <PageSection
                id="try-it"
                title="Try it"
                lead="The inbox works on this page, without an account.">
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
