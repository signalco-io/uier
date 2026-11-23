import { Button } from '@uier/ui-primitives/Button';
import { InlineLink, NumberedList, PageHeader, PageSection, Panel, StepsPanel, Tile } from '@/src/components/marketing/ContentPage';
import { FixVerificationSpecimen } from '@/src/components/marketing/FixVerificationSpecimen';
import { ReviewChecklistSpecimen } from '@/src/components/marketing/guides/PracticalReviewSpecimens';
import { KnownPages } from '@/src/knownPages';
import { publicPageMetadata } from '@/src/lib/metadata';
import { useCases } from '@/src/lib/useCases';

// Sources: docs/review-workflow.md (environments, review briefs, statuses and verification),
// apps/web/docs/project-settings.md (custom statuses), fix-verification.md (project opt-in).
// The manual review example is fictional. uier records findings, not test execution or release approval.
export const metadata = publicPageMetadata(useCases.userAcceptanceTesting.path, useCases.userAcceptanceTesting);

const journeys = [
    { journey: 'Find Sunday hours', expected: 'The contact page shows 12–22.', result: 'Finding: the row still says Closed.' },
    { journey: 'Start a booking on a phone', expected: 'Book a table opens the booking form after the menu closes.', result: 'Finding: the button remains covered.' },
    { journey: 'Open the contact map', expected: 'The agreed maps destination opens.', result: 'Not checked: the reviewer ran out of time.' }
];

const steps = [
    { title: 'Choose the review environment', text: 'Add the intended staging or production addresses to the project. Share the review link for that environment and state which deployed version the team is reviewing.' },
    { title: 'Invite the right people', text: 'Give named reviewers access to the project and the site. Put the scope and expected journeys in the review brief. Use guest links only when their access and visibility suit the review.' },
    { title: 'Run the journeys by hand', text: 'Ask reviewers to perform the agreed tasks on the actual page. Record what was checked and what was not; a lack of comments does not prove a test passed.' },
    { title: 'Keep findings with the page', text: 'Add one thread per problem with expected and actual behavior, reproduction steps and available evidence. Assign the next action and discuss missing context in that thread.' }
];

export default function UserAcceptanceTestingPage() {
    return <main className="flex flex-col pb-16">
        <PageHeader
            title="Run a manual acceptance review on the live site"
            lead="Agree what people should check, collect findings in the right environment and return to the page to check the fixes.">
            <div className="flex flex-wrap items-center gap-2.5">
                <Button variant="solid" size="lg" href={KnownPages.App}>Create a project</Button>
                <Button variant="outlined" size="lg" href={KnownPages.ReviewChecklist}>Use the review checklist</Button>
            </div>
        </PageHeader>

        <PageSection id="scope" title="Agree what this round should prove" lead="An example acceptance round for the imaginary restaurant site.">
            <div className="grid items-start gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <ReviewChecklistSpecimen />
                <dl className="flex flex-col gap-4 text-sm leading-relaxed">
                    <div><dt className="font-medium">Environment</dt><dd className="text-muted-foreground">The staging site with the proposed summer opening hours and booking changes.</dd></div>
                    <div><dt className="font-medium">Reviewers</dt><dd className="text-muted-foreground">The restaurant manager checks content. A teammate checks the booking journey on a phone.</dd></div>
                    <div><dt className="font-medium">Scope</dt><dd className="text-muted-foreground">Contact details, opening hours, menu navigation and starting a booking.</dd></div>
                    <div><dt className="font-medium">Outside this round</dt><dd className="text-muted-foreground">Payments, load testing and a full accessibility audit. Record these as not checked.</dd></div>
                </dl>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
                These are team-agreed checks. The reviewers run them by hand. uier records the findings; it does not execute a test suite or enforce release approval.
            </p>
        </PageSection>

        <PageSection id="review" title="Review one environment at a time" lead="A staging finding should be checked against the staging change.">
            <StepsPanel steps={steps} />
            <p className="text-sm leading-relaxed text-muted-foreground">
                The <InlineLink href={KnownPages.ClientReviewGuide}>client-review setup guide</InlineLink> covers installation, invitations and review links. <InlineLink href={KnownPages.PinnedComments}>Pinned comments</InlineLink> explains annotation and reattachment when a page changes.
            </p>
        </PageSection>

        <PageSection id="example" title="Record findings and gaps" lead="A fictional review log. The team writes the observations; uier does not run these checks.">
            <div className="overflow-hidden rounded-2xl border">
                <table className="w-full table-fixed border-collapse text-left text-sm [overflow-wrap:anywhere]">
                    <caption className="sr-only">Example manual restaurant website acceptance review</caption>
                    <thead className="bg-muted/50">
                        <tr><th scope="col" className="p-3 font-semibold">Journey</th><th scope="col" className="p-3 font-semibold">Expected</th><th scope="col" className="p-3 font-semibold">Observation</th></tr>
                    </thead>
                    <tbody>
                        {journeys.map(item => <tr key={item.journey} className="border-t align-top">
                            <th scope="row" className="p-3 font-medium">{item.journey}</th>
                            <td className="p-3 leading-relaxed text-muted-foreground">{item.expected}</td>
                            <td className="p-3 leading-relaxed text-muted-foreground">{item.result}</td>
                        </tr>)}
                    </tbody>
                </table>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
                Turn each finding into a thread using the <InlineLink href={KnownPages.BugReporting}>bug-reporting workflow</InlineLink>. Keep a separate record of checks with no finding and checks that were not performed. The <InlineLink href={KnownPages.ReviewChecklist}>review checklist</InlineLink> helps keep that scope visible.
            </p>
        </PageSection>

        <PageSection id="track" title="Keep the fix and its review distinct" lead="The project’s statuses show progress. They do not approve a release.">
            <Panel>
                <Tile title="Give each finding a next action">
                    <p>Assign an owner, set a priority and use the project’s list or board. Workspace defaults and project overrides can name statuses within the supported categories; ordinary Done still means completion.</p>
                    <p><InlineLink href={KnownPages.FeedbackTriage}>Feedback triage</InlineLink> and supported <InlineLink href={KnownPages.Integrations}>integrations</InlineLink> help the team work through findings. Archive keeps completed threads out of the active view without deleting their evidence.</p>
                </Tile>
                <Tile title="Enable checks only when the project needs them">
                    <p>Fix verification is off by default. An admin can turn on Enable fix verification in Project settings → Review. A member can then request an optional check on an individual thread and choose an eligible reviewer.</p>
                    <p>The pending thread is Ready to verify and still unresolved. The chosen reviewer can confirm the fix or say it still needs work. An original guest author uses the same visitor identity while guest access remains allowed; a different admin’s decision is labeled as an override.</p>
                </Tile>
            </Panel>
            <FixVerificationSpecimen />
            <p className="text-sm leading-relaxed text-muted-foreground">
                This picture shows a project with verification enabled. Ordinary Done, bulk Done, connected-service closure and an MCP status change never stand in for reviewer confirmation. Read the <InlineLink href={KnownPages.FixVerification}>fix-verification rules</InlineLink> before choosing this workflow.
            </p>
        </PageSection>

        <PageSection id="handoff" title="Hand off what remains" lead="A checked fix is evidence for one thread, not a site-wide sign-off.">
            <NumberedList items={[
                'After the change is deployed, repeat the original journey in the intended environment. Record any new finding separately.',
                'List unresolved findings with their owners, priorities and the decision or change still needed.',
                'Keep the not-checked list and any limits of the review alongside the results. Do not turn missing evidence into a pass.',
                'Agree the release decision with the responsible people outside the thread workflow. Confirming one fix does not approve the whole release.'
            ]} />
            <p className="text-sm leading-relaxed text-muted-foreground">
                Review access and sensitive evidence before inviting people. The <InlineLink href={KnownPages.Security}>security page</InlineLink> and <InlineLink href={KnownPages.LegalPrivacyPolicy}>privacy policy</InlineLink> explain the boundaries. For the client conversation around a round, see <InlineLink href={KnownPages.ClientFeedback}>client website feedback</InlineLink>.
            </p>
            <Button variant="solid" size="lg" href={KnownPages.App} className="self-start">Plan an acceptance review</Button>
        </PageSection>
    </main>;
}
