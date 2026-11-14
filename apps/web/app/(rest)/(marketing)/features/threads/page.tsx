import { publicPageMetadata } from '@/src/lib/metadata';
import { Button } from '@signalco/ui-primitives/Button';
import { brand } from '@uier/brand';
import { CheckList, InlineLink, NumberedList, PageHeader, PageSection, Panel, StepsPanel, Tile } from '../../../../../src/components/marketing/ContentPage';
import { FaqPanel, type Question } from '../../../../../src/components/marketing/LandingFaq';
import { ThreadsCover } from '../../../../../src/components/marketing/covers/ThreadsCover';
import { KnownPages } from '../../../../../src/knownPages';

// The discussion on a comment, as it ships in the toolbar and the app: replies from the page, the inbox
// and the app (docs/review-workflow.md "Replies from the app and inbox"), the message editor and Markdown
// (packages/toolbar/docs/message-editor.md, message-markdown.md), reactions (reactions.md), mentions and
// assignees ("Assignment and mentions"), AI agents under the assignee, following and email
// ("Review email notifications") and who may edit, delete or make a thread private
// (src/lib/review/comments.ts). Change this page with them.

const title = 'Threads, mentions and assignees';
const description = 'Discuss each comment where it was left: reply with formatting and images, mention teammates, assign the people who fix it and follow replies by email.';

export const metadata = publicPageMetadata(KnownPages.Threads, { title, description });

const steps = [
    {
        title: 'Reply where it is',
        text: 'Open a pin on the page, or the thread in the toolbar’s inbox or in the app, and reply. You can answer from the app or the inbox without opening the page, and replying keeps the thread’s status.'
    },
    {
        title: 'Mention and assign',
        text: 'Type @ to mention a member who can see the thread. Assign one or more people from the thread’s options; they see it under Assigned to me.'
    },
    {
        title: 'Follow it by email',
        text: 'Members follow the threads they post in and can follow any other. Replies, mentions and assignments arrive in one email after five minutes, without what you have already read.'
    }
];

const writing = [
    { title: 'Formatting as you type', text: 'Bold, italic, code, lists, quotes and links. Type the Markdown or use the shortcuts; the message is saved as Markdown, so it reads the same in emails and connected services.' },
    { title: 'Images and recordings', text: 'Attach or paste an image, or record a short clip of the screen, with any reply.' },
    { title: 'Reactions', text: 'React to any message with an emoji instead of another reply. Hover a reaction to see who left it.' },
    { title: 'Colour values', text: 'A colour such as #ED1C24 shows a small swatch of itself, so a design note shows the colour it means.' }
];

const people = [
    'Guests can comment and reply on projects that let anyone with the link comment, without an account. After commenting they can choose Email me replies and confirm their address.',
    'Mentions and assignments reach only people who can already see the thread. Neither adds anyone to the project.',
    'Each message’s author can edit or delete it, and workspace admins can delete it.',
    'A workspace admin can make a thread private: then only its author and the workspace’s admins can see it.',
    <>An AI agent can work under an assignee and show on the thread while it fixes the problem. <InlineLink href={KnownPages.Ai}>AI features</InlineLink> explains how.</>
];

const tryIt = [
    'Open a pin on this page, or a thread in the inbox of the toolbar at the bottom of this window.',
    'Write a reply and press Enter. Shift+Enter starts a new line.',
    'Mentions, assignees and email updates work in a project of your own.'
];

const questions: Question[] = [
    {
        question: 'Do reviewers need an account to reply?',
        answer: <>Not on a project that lets anyone with the link comment: guests reply under a name such as &ldquo;Guest 3F2A&rdquo;. On a project for invited people only, reviewers sign in with an emailed code, Google, Microsoft or a passkey.</>
    },
    {
        question: 'What is in the emails?',
        answer: <>Who did what, on which thread and page, with a link to it. The comment&rsquo;s text is left out unless a workspace admin turns on comment excerpts for the project. Screenshots, quoted page text and browser details are never included.</>
    },
    {
        question: 'Can I stop the emails?',
        answer: <>Yes. Unfollow a thread from its options, or mute a project&rsquo;s emails from the toolbar or the project&rsquo;s settings. Account → Notifications lists every project.</>
    },
    {
        question: 'Can a thread get too long?',
        answer: <>A thread holds up to 50 messages. Longer discussions are better split into threads of their own.</>
    },
    {
        question: 'Can I send a thread to an issue tracker?',
        answer: <>Yes. Copy issue turns it into Markdown with the page, the anchor, the browser details and the discussion. A project can also send shared threads to a <InlineLink href={KnownPages.Integrations}>connected service</InlineLink>.</>
    },
    {
        question: 'What does it cost?',
        answer: <>Nothing. {brand.pricing}</>
    }
];

export default function ThreadsPage() {
    return (
        <main className="flex flex-col pb-16">
            <PageHeader
                title="Talk it through in the thread"
                lead="Every comment is a thread. Reply on the page or in the app, mention a teammate, assign the people who fix it and follow the replies by email.">
                <div className="flex flex-wrap items-center gap-2.5">
                    <Button variant="solid" size="lg" href={KnownPages.App}>Get started</Button>
                    <Button variant="outlined" size="lg" href="#how-it-works">How it works</Button>
                </div>
            </PageHeader>
            <ThreadsCover />

            <PageSection
                id="how-it-works"
                title="How it works"
                lead="The thread stays with the comment, on the page and in the app.">
                <StepsPanel steps={steps} />
            </PageSection>

            <PageSection
                id="writing"
                title="Writing a reply"
                lead="Every text box, in the toolbar and in the app, formats as you write.">
                <Panel className="md:grid-cols-2">
                    {writing.map(item => (
                        <Tile key={item.title} title={item.title}>
                            <p>{item.text}</p>
                        </Tile>
                    ))}
                </Panel>
            </PageSection>

            <PageSection
                id="people"
                title="Who takes part"
                lead="The project decides who can comment. The thread keeps to what each person can see.">
                <CheckList items={people} />
            </PageSection>

            <PageSection
                id="try-it"
                title="Try it"
                lead="Replies work on this page, without an account.">
                <NumberedList items={tryIt} />
                <Button variant="solid" href={KnownPages.App} className="self-start">Create a project</Button>
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
