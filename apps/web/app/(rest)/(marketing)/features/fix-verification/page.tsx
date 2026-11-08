import { publicPageMetadata } from '@/src/lib/metadata';
import { Button } from '@signalco/ui-primitives/Button';
import { brand } from '@uier/brand';
import { CheckList, InlineLink, PageHeader, PageSection, Panel, Tile } from '../../../../../src/components/marketing/ContentPage';
import { FaqPanel, type Question } from '../../../../../src/components/marketing/LandingFaq';
import { FixVerificationSpecimen } from '../../../../../src/components/marketing/FixVerificationSpecimen';
import { KnownPages } from '../../../../../src/knownPages';

// The fix-verification workflow (docs/review-workflow.md, "Fix verification"). Labels and actor rules
// are the shipped ones: the thread's controls (VerificationControl in the app, CommentVerification and
// verification.ts in the toolbar), changeFixVerification and verificationPermissions in
// src/lib/review. Change this page with them. Ordinary Done, bulk Done, a connected service closing its
// issue and MCP status are never reviewer confirmation; say so wherever they come up.

export const metadata = publicPageMetadata(KnownPages.FixVerification, {
    title: 'Fix verification for website feedback',
    description: `Ask the person who reported a problem to confirm the fix. ${brand.name} records who confirmed it and when, apart from marking it done.`
});

const steps = [
    {
        title: 'Request verification',
        text: 'In the app, choose Ready to verify in a thread’s status menu; in the toolbar, choose Request verification. Add a short fix summary and an optional fix link, then choose the reviewer. The original author is suggested while they still have access.'
    },
    {
        title: 'Ready to verify',
        text: 'The thread shows Ready to verify in the app, on the page and in the toolbar inbox, and still counts as open. The reviewer gets an email under their usual notification settings.'
    },
    {
        title: 'Confirm fix or Still needs work',
        text: 'The reviewer checks the page. Confirm fix marks the thread done with their name and the time. Still needs work moves it to In progress for the next attempt.'
    }
];

const actions: { action: string; who: string; result: string }[] = [
    { action: 'Request verification', who: 'A project member who can see the thread', result: 'Ready to verify. The thread counts as open, even if it was done.' },
    { action: 'Confirm fix', who: 'The requested reviewer', result: 'Done, with the reviewer’s name and the time.' },
    { action: 'Still needs work', who: 'The requested reviewer', result: 'In progress, marked Still needs work. The next check is a new request.' },
    { action: 'Confirm fix as admin, Still needs work as admin', who: 'A workspace admin who is not the requester or the reviewer', result: 'The same result, labeled as an admin override for the reviewer.' },
    { action: 'Cancel request', who: 'The requester or an admin', result: 'Back to Open or In progress, where it was before the request. In the app’s status menu, choose which.' },
    { action: 'Done without verification', who: 'Anyone who can already mark the thread done', result: 'Done without reviewer confirmation.' },
    { action: 'Reopen', who: 'Anyone who can already reopen the thread', result: 'Open. An earlier confirmation is kept as history only.' }
];

const fixLinks = [
    'The fixed page on one of the project’s addresses, such as staging',
    'A preview deployment or a pull request, over HTTPS',
    'A short plain-text summary of what changed'
];

const useCases = [
    {
        title: 'Client review',
        text: 'The client who asked for the change confirms it on the page, as a guest if they reviewed through a review link.'
    },
    {
        title: 'Bug reports',
        text: 'The person who reported the bug checks the fix where they found it, rather than the developer closing it unchecked.'
    },
    {
        title: 'Acceptance testing',
        text: 'Testers confirm the fixes for what they reported before a release. Each thread records its own decision; it is not a sign-off of the release.'
    }
];

const tryIt = [
    'Sign in and create a project for your site.',
    'Add the script tag, or open a review link, and leave feedback.',
    'When a fix is ready, set the thread to Ready to verify and request verification.'
];

const questions: Question[] = [
    {
        question: 'Does every thread need verification?',
        answer: <>No. It is optional for each thread. There is no project-wide approval step and no custom workflow: Done and Reopen work as before, and a thread waiting for its reviewer can still be marked Done without verification.</>
    },
    {
        question: 'Can the person who fixed it confirm it?',
        answer: <>No. The requester cannot choose themselves as the reviewer or confirm their own request, not even as an admin. They can still mark the thread done, which is recorded as done without reviewer confirmation.</>
    },
    {
        question: 'What if the reviewer is not available?',
        answer: <>Request a new check from another member who can see the thread, or ask a workspace admin. An admin decision names the admin and says it was made on the reviewer’s behalf. {brand.name} never puts someone else in the reviewer’s place on its own.</>
    },
    {
        question: 'Does closing the issue in GitHub or Linear confirm the fix?',
        answer: <>No. With two-way status sync, closing the issue in a <InlineLink href={KnownPages.Integrations}>connected service</InlineLink> marks the thread done without reviewer confirmation, and reopening it there reopens the thread. A thread that is ready to verify shows as open there.</>
    },
    {
        question: 'Can an AI agent confirm a fix?',
        answer: <>No. Through the MCP connector, an agent can request or cancel a check after you approve that exact action. Setting a thread’s status through MCP is an ordinary Done, never a confirmation.</>
    },
    {
        question: 'Does it check the fix for me?',
        answer: <>No. A person checks the page and decides. {brand.name} records the request, the decision, who made it and when. It does not take a second screenshot; the original comment and screenshot stay as they were.</>
    },
    {
        question: 'What does it cost?',
        answer: <>Nothing. {brand.pricing}</>
    }
];

export default function FixVerificationPage() {
    return (
        <main className="flex flex-col pb-16">
            <PageHeader
                title="Ask the reviewer to confirm the fix"
                lead="When a fix is ready, the person who reported the problem, or another reviewer you choose, checks it on the page. They confirm the fix or say it still needs work, and the thread records who decided and when.">
                <div className="flex flex-wrap items-center gap-2.5">
                    <Button variant="solid" size="lg" href={KnownPages.App}>Get started</Button>
                    <Button variant="outlined" size="lg" href="#how-it-works">How it works</Button>
                </div>
            </PageHeader>

            <PageSection
                id="how-it-works"
                title="How it works"
                lead="Three steps on a thread you already have. Replies, priority and search keep working throughout.">
                <FixVerificationSpecimen />
                <Panel as="ol">
                    {steps.map((step, index) => (
                        <li key={step.title} className="flex items-baseline gap-4 p-6">
                            <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
                            <span className="flex flex-col gap-1">
                                <span className="text-base font-semibold">{step.title}</span>
                                <span className="text-sm leading-relaxed text-muted-foreground">{step.text}</span>
                            </span>
                        </li>
                    ))}
                </Panel>
            </PageSection>

            <PageSection
                id="who-decides"
                title="Who can decide"
                lead="Only the reviewer you asked can confirm the fix, or an admin who says they are deciding for them.">
                <div className="overflow-hidden rounded-2xl border">
                    <table className="w-full border-collapse text-left text-sm">
                        <caption className="sr-only">Fix verification actions, who can take them and what happens</caption>
                        <thead className="bg-muted/50">
                            <tr>
                                <th scope="col" className="p-3 font-semibold md:p-4">Action</th>
                                <th scope="col" className="p-3 font-semibold md:p-4">Who</th>
                                <th scope="col" className="p-3 font-semibold md:p-4">Result</th>
                            </tr>
                        </thead>
                        <tbody>
                            {actions.map(row => (
                                <tr key={row.action} className="border-t align-top">
                                    <th scope="row" className="p-3 font-medium md:p-4">{row.action}</th>
                                    <td className="p-3 text-muted-foreground md:p-4">{row.who}</td>
                                    <td className="p-3 text-muted-foreground md:p-4">{row.result}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <Panel className="md:grid-cols-2">
                    <Tile title="Guests answer as themselves">
                        <p>When the reviewer is the guest who left the feedback, they answer with the same visitor identity, in the browser they commented from, while anyone with the link can still comment on the project. No account or email check is needed, and other guests cannot answer for them.</p>
                    </Tile>
                    <Tile title="No one else steps in">
                        <p>If the original author is gone or has lost access, choose another member who can see the thread. The requester can never be the reviewer.</p>
                    </Tile>
                </Panel>
            </PageSection>

            <PageSection
                id="done-is-not-confirmed"
                title="Done is not the same as confirmed"
                lead="A thread can be done without anyone checking the fix. Only a reviewer’s decision counts as confirmation.">
                <Panel className="md:grid-cols-2">
                    <Tile title="Done without verification">
                        <p>
                            Marking threads done, one at a time or with <InlineLink href={KnownPages.FeedbackTriage}>bulk triage</InlineLink>, is ordinary
                            completion, never a reviewer’s confirmation. A thread that was Ready to verify shows Done without reviewer confirmation.
                        </p>
                    </Tile>
                    <Tile title="Connected issue trackers">
                        <p>With two-way status sync on, closing the issue in a connected service marks the thread done without confirmation. Ready to verify shows there as open.</p>
                    </Tile>
                    <Tile title="AI agents">
                        <p>An agent can request or cancel a check after you approve it. It cannot confirm a fix.</p>
                    </Tile>
                    <Tile title="Reopen">
                        <p>Reopening a confirmed thread makes the earlier confirmation history. A new check starts a new request.</p>
                    </Tile>
                </Panel>
                <p className="max-w-[720px] text-sm text-muted-foreground">
                    Copy issue, the MCP connector and connected services include the outcome, with the name and time of the decision, beside the usual open or done status.
                </p>
            </PageSection>

            <PageSection
                id="fix-links"
                title="Fix links"
                lead="Point the reviewer at the fixed page. A short summary says what changed.">
                <CheckList items={fixLinks} />
                <p className="max-w-[720px] text-sm text-muted-foreground">
                    Links to other sites cannot carry a query string, a fragment or credentials, and links to the project’s addresses can carry only the page state the project allows. {brand.name} never fetches or embeds a fix link; the reviewer opens it.
                </p>
            </PageSection>

            <PageSection
                id="use-cases"
                title="Where it helps"
                lead="Anywhere the person who found a problem should be the one to say it is fixed.">
                <Panel className="md:grid-cols-3">
                    {useCases.map(item => (
                        <Tile key={item.title} title={item.title}>
                            <p>{item.text}</p>
                        </Tile>
                    ))}
                </Panel>
            </PageSection>

            <PageSection
                id="try-it"
                title="Try it"
                lead="Try it on a project of your own, where you choose who checks each fix.">
                <ol className="flex flex-col gap-4">
                    {tryIt.map((step, index) => (
                        <li key={step} className="flex items-baseline gap-4">
                            <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
                            <span className="text-base">{step}</span>
                        </li>
                    ))}
                </ol>
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
