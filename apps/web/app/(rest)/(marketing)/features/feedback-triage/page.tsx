import { publicPageMetadata } from '@/src/lib/metadata';
import { Button } from '@signalco/ui-primitives/Button';
import { brand } from '@uier/brand';
import { CheckList, InlineLink, PageHeader, PageSection, Panel, Tile } from '../../../../../src/components/marketing/ContentPage';
import { TriageSpecimen } from '../../../../../src/components/marketing/TriageSpecimen';
import { KnownPages } from '../../../../../src/knownPages';

// Every claim and bound here is the shipped app triage (docs/review-workflow.md, "Search, priority
// and bulk triage"): MAX_PROJECT_COMMENTS (src/lib/review/comments.ts), MAX_TRIAGE_THREADS
// (src/lib/review/bulkTriageSchema.ts), TriageSelection and CommentFilters. Change this page with them.
// Bulk Done is ordinary completion: a pending fix check ends as Done without reviewer confirmation
// (comments/verificationState.ts, @uier/toolbar/verification labels). The fix verification workflow
// is described on its own page (/features/fix-verification), linked from Mark selected as done.

const title = 'Feedback triage';

export const metadata = publicPageMetadata(KnownPages.FeedbackTriage, {
    title,
    description: `Search a project's feedback, set priorities and assign, complete or reopen up to 50 selected threads at once in the ${brand.name} app.`
});

const workflowGuide = `${brand.repository}/blob/main/docs/review-workflow.md#search-priority-and-bulk-triage`;

const outcomes = [
    { label: 'Changed', text: 'The action was saved.' },
    { label: 'Unchanged', text: 'The thread already had that value.' },
    { label: 'Stale', text: 'Someone changed the thread after you selected it, so it was skipped. For Done and Reopen, a new reply or edit counts too.' },
    { label: 'Unavailable', text: 'The thread was deleted, or you can no longer see it.' },
    { label: 'Failed', text: 'The save did not finish. Retry failed threads repeats the same action for them.' }
];

export default function FeedbackTriagePage() {
    return (
        <main className="flex flex-col pb-16">
            <PageHeader title={title} lead={`Search a project's feedback, give threads a priority and act on up to 50 of them at once, in the ${brand.name} app.`}>
                <div className="flex flex-wrap items-center gap-2.5">
                    <Button variant="solid" size="lg" href={KnownPages.App}>Get started</Button>
                    <Button variant="outlined" size="lg" href="#limits">See the limits</Button>
                </div>
            </PageHeader>

            <PageSection
                id="overview"
                title="One list to sort through"
                lead="A project's feedback in the app has a search field, a priority filter and a checkbox on every thread you can triage."
                wide>
                <TriageSpecimen />
            </PageSection>

            <PageSection id="search" title="Find the threads" lead="Search filters the threads the app has already loaded, so the list changes as you type.">
                <Panel className="md:grid-cols-3">
                    <Tile title="What it searches">
                        <p>Every word must appear in the first message, a reply, the quoted text, the page path or the thread number, such as #12. Case does not matter. Deleted text is not searched.</p>
                    </Tile>
                    <Tile title="With the filters">
                        <p>Search combines with the status, priority, people, page and unread filters. Choosing another environment loads its threads first.</p>
                    </Tile>
                    <Tile title="Kept in the address">
                        <p>The search and the filters stay in the page address, so reloading or going back keeps them.</p>
                    </Tile>
                </Panel>
            </PageSection>

            <PageSection id="priority" title="Give threads a priority" lead="Low, Normal, High or Urgent. Older feedback without one counts as Normal.">
                <CheckList items={[
                    'Change it on a thread in the app, or in the thread and the inbox of the toolbar while you review a page.',
                    'Filter the list by priority. The order of the list stays the same.',
                    'Guests on a review link see the priority but cannot change it.',
                    'A change counts as new activity on the thread. It sends no email on its own.',
                    'Copy issue, connected integrations and the MCP connector include the priority as context. They do not change priorities or labels in the other tool.'
                ]} />
            </PageSection>

            <PageSection
                id="selection"
                title="Act on a selection"
                lead="Check the threads you want, or select the shown results with the checkbox above the list. Then choose one action for all of them.">
                <Panel className="md:grid-cols-2">
                    <Tile title="Assign selected">
                        <p>Assign the threads to one person who can see all of them, or choose Unassign.</p>
                    </Tile>
                    <Tile title="Set priority">
                        <p>Give every selected thread the same priority.</p>
                    </Tile>
                    <Tile title="Mark selected as done">
                        <p>
                            Each thread becomes Done, as it would with its own Done button. This is ordinary completion, never a reviewer&rsquo;s
                            confirmation: a thread that was Ready to verify shows Done without reviewer confirmation.
                            {' '}<InlineLink href={KnownPages.FixVerification}>Fix verification</InlineLink> is how a reviewer confirms a fix.
                        </p>
                    </Tile>
                    <Tile title="Reopen selected">
                        <p>Done threads go back to Open, and a pending fix check ends. In progress stays as it is.</p>
                    </Tile>
                </Panel>
                <p className="max-w-[720px] text-sm leading-relaxed text-muted-foreground">
                    Selection works in List and Board. Changing the project, environment, author, search, a filter or the view clears it.
                    Threads that arrive while an action runs are never added to it.
                </p>
            </PageSection>

            <PageSection id="results" title="Partial results and retries" lead="Each selected thread is saved on its own, so one problem does not undo the rest.">
                <Panel as="ul">
                    {outcomes.map(outcome => (
                        <li key={outcome.label} className="flex flex-col gap-1 p-6 md:flex-row md:items-baseline md:gap-6">
                            <span className="text-sm font-medium md:w-28 md:shrink-0">{outcome.label}</span>
                            <span className="text-sm leading-relaxed text-muted-foreground md:flex-1">{outcome.text}</span>
                        </li>
                    ))}
                </Panel>
                <p className="max-w-[720px] text-sm leading-relaxed text-muted-foreground">
                    Changed threads leave the selection. Threads that need attention stay selected while they are shown, listed by number.
                    A retry sends the same submission again, so it cannot apply an action twice or overwrite a newer change.
                </p>
            </PageSection>

            <PageSection id="limits" title="Limits" lead="Triage works within these bounds today.">
                <Panel className="md:grid-cols-2">
                    <Tile title="1,000 recent threads">
                        <p>Search and filters cover up to 1,000 of the most recent threads in the loaded environment. When there are more, the app says so: narrow the environment or the author to reach older feedback.</p>
                    </Tile>
                    <Tile title="50 threads per action">
                        <p>You can select up to 50 shown threads. With more results, Select first 50 shown takes the first 50 in the order shown: Open, In progress, Ready to verify, then Done on the board. The rest stay as they are.</p>
                    </Tile>
                    <Tile title="One project at a time">
                        <p>Search and actions cover the project you have open. There is no search across projects, and an action only reaches the threads you selected.</p>
                    </Tile>
                    <Tile title="What bulk actions leave out">
                        <p>They do not delete threads, make them private, mark them as read or confirm a fix. Mark all as read is its own button. In the toolbar you change one thread at a time.</p>
                    </Tile>
                </Panel>
            </PageSection>

            <PageSection id="permissions" title="Who can triage" lead="The server checks every thread again when it saves, not only when you select it.">
                <Panel className="md:grid-cols-3">
                    <Tile title="Project members">
                        <p>Workspace admins and commenters with access to the project can search, set priorities and use bulk actions on the threads they can see.</p>
                    </Tile>
                    <Tile title="Guests">
                        <p>People who review through a link see each thread&rsquo;s priority. They cannot change it or select threads.</p>
                    </Tile>
                    <Tile title="Private threads">
                        <p>Search and selection include only threads you can see. Private threads are visible to admins and their author.</p>
                    </Tile>
                </Panel>
            </PageSection>

            <PageSection id="start" title="Try it in a project" lead={brand.pricing}>
                <p className="max-w-[720px] text-base leading-relaxed">
                    Sign in, create a project and invite your team. Triage is in each project&rsquo;s feedback list.
                    See <InlineLink href={KnownPages.Features}>what else {brand.name} does</InlineLink>, how feedback reaches
                    your tools through <InlineLink href={KnownPages.Integrations}>integrations</InlineLink>, or
                    the <InlineLink href={workflowGuide}>review workflow guide</InlineLink> for the technical details.
                </p>
                <Button variant="solid" href={KnownPages.App} className="self-start">Get started</Button>
            </PageSection>
        </main>
    );
}
