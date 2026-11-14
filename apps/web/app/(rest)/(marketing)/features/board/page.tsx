import type { ReactNode } from 'react';
import { publicPageMetadata } from '@/src/lib/metadata';
import { Button } from '@signalco/ui-primitives/Button';
import { brand } from '@uier/brand';
import { CheckList, InlineLink, NumberedList, PageHeader, PageSection, Panel, StepsPanel, Tile } from '../../../../../src/components/marketing/ContentPage';
import { FaqPanel, type Question } from '../../../../../src/components/marketing/LandingFaq';
import { StatusDot, type Stage } from '../../../../../src/components/marketing/LandingSpecimens';
import { BoardCover } from '../../../../../src/components/marketing/covers/BoardCover';
import { KnownPages } from '../../../../../src/knownPages';

// A thread's status from Open to Done and the app's list and board, as they ship: the stages
// (apps/web/docs/in-progress.md, `feedbackStage`), who may change them (`canResolveComment` in
// src/lib/review/comments.ts), the comments list, the board and its drag, touch and keyboard moves, Archive
// (apps/web/docs/comments-inbox.md), the filters (comment-filters.md), My work (app-shell.md) and the
// status sync of connected services (docs/review-workflow.md). Change this page with them. Done is
// not a reviewer's confirmation: that is fix verification, linked rather than described here.

const title = 'Feedback statuses and board';
const description = 'Follow each thread from Open through In progress and Ready to verify to Done, in a list or on a board, on the page and in the app.';

export const metadata = publicPageMetadata(KnownPages.Board, { title, description });

const statuses: { stage: Stage; name: string; text: ReactNode }[] = [
    { stage: 'open', name: 'Open', text: 'New feedback, and threads opened again.' },
    { stage: 'in-progress', name: 'In progress', text: 'Someone is working on it.' },
    { stage: 'ready', name: 'Ready to verify', text: <>A fix waits for the reviewer to confirm it. <InlineLink href={KnownPages.FixVerification}>Fix verification</InlineLink> explains how.</> },
    { stage: 'done', name: 'Done', text: 'Fixed or settled. Its pin leaves the page, and the thread stays under Done.' }
];

const steps = [
    {
        title: 'Change it where you are',
        text: 'Every thread has a status menu: in its thread on the page, in the toolbar’s inbox and in the app. A change shows in all of them, for everyone.'
    },
    {
        title: 'Work through a list',
        text: 'The app lists a project’s threads as compact rows with their status, priority and assignees. The arrow keys move through them, and each opens beside the list.'
    },
    {
        title: 'Or move cards on a board',
        text: 'Switch to Board for a column per status. Drag a card to another column, press and hold it on a touch screen, or focus it and press M to move it from the keyboard.'
    }
];

const board = [
    'While a card is dragged, the columns it can go to are dashed. Escape puts it back.',
    'Dropping a card on Ready to verify asks for the fix check first: a short summary, an optional link and the reviewer.',
    'When anyone changes a thread’s status, its card travels to its new column instead of jumping there.',
    'Archive, beside Done, keeps finished threads out of the way without deleting them. Archive all moves a whole Done column there.'
];

const filters = [
    { title: 'Active, Done and All', text: 'Active is everything not done. Its menu narrows it to Open, In progress or Ready to verify.' },
    { title: 'Filters', text: 'Priority, environment and page, who it is assigned to or opened by, and only unread.' },
    { title: 'Search', text: 'Search a project’s feedback by its words, including older threads.' },
    { title: 'My work', text: 'Open threads assigned to you, threads that mention you and other unread threads, across your projects, as a list or a board.' }
];

const tryIt = [
    'Sign in and create a project for your site.',
    'Add the script tag, or open a review link, and leave a few comments.',
    'In the app, open the project’s comments and switch to Board.'
];

const questions: Question[] = [
    {
        question: 'Who can change a status?',
        answer: <>Project members, and the person who left the comment. Guests who are not the author see the status but cannot change it.</>
    },
    {
        question: 'Does Done mean the fix was checked?',
        answer: <>No. Done is ordinary completion. To have the reviewer confirm a fix first, set the thread to Ready to verify; <InlineLink href={KnownPages.FixVerification}>Fix verification</InlineLink> explains who decides.</>
    },
    {
        question: 'Can I change many threads at once?',
        answer: <>Yes. In the app, select up to 50 threads to mark them done, reopen them, assign them or set their priority. <InlineLink href={KnownPages.FeedbackTriage}>Feedback triage</InlineLink> explains how.</>
    },
    {
        question: 'Does the status follow my issue tracker?',
        answer: <>With two-way status sync on, closing the issue in a <InlineLink href={KnownPages.Integrations}>connected service</InlineLink> marks the thread done, and reopening it there opens the thread again.</>
    },
    {
        question: 'Does the board work on a phone?',
        answer: <>Yes. Columns scroll sideways, a card moves with a press and hold, and tapping a card opens its thread, where the status menu changes it.</>
    },
    {
        question: 'What does it cost?',
        answer: <>Nothing. {brand.pricing}</>
    }
];

export default function BoardPage() {
    return (
        <main className="flex flex-col pb-16">
            <PageHeader
                title="Follow every thread from open to done"
                lead="Each thread has a status: Open, In progress, Ready to verify or Done. Change it on the page or in the app, and see where all of a project’s feedback stands in a list or on a board.">
                <div className="flex flex-wrap items-center gap-2.5">
                    <Button variant="solid" size="lg" href={KnownPages.App}>Get started</Button>
                    <Button variant="outlined" size="lg" href="#how-it-works">How it works</Button>
                </div>
            </PageHeader>
            <BoardCover />

            <PageSection
                id="statuses"
                title="Four statuses"
                lead="Each has its colour, on the pin, in the inbox and in the app.">
                <Panel as="ul" className="md:grid-cols-2">
                    {statuses.map(status => (
                        <li key={status.stage} className="flex flex-col gap-2 p-6">
                            <span className="flex items-center gap-2">
                                <StatusDot stage={status.stage} />
                                <h3 className="text-base font-semibold">{status.name}</h3>
                            </span>
                            <p className="text-sm leading-relaxed text-muted-foreground">{status.text}</p>
                        </li>
                    ))}
                </Panel>
            </PageSection>

            <PageSection
                id="how-it-works"
                title="How it works"
                lead="The same status on the page and in the app, and two ways to see them all.">
                <StepsPanel steps={steps} />
            </PageSection>

            <PageSection
                id="board"
                title="The board"
                lead="A column for each status, and a card for each thread.">
                <CheckList items={board} />
            </PageSection>

            <PageSection
                id="filters"
                title="Find what to work on"
                lead="The list and the board share their filters, and the choice stays in the address, so a link opens the same view.">
                <Panel className="md:grid-cols-2">
                    {filters.map(item => (
                        <Tile key={item.title} title={item.title}>
                            <p>{item.text}</p>
                        </Tile>
                    ))}
                </Panel>
            </PageSection>

            <PageSection
                id="try-it"
                title="Try it"
                lead="The board is in the app, in a project of your own.">
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
