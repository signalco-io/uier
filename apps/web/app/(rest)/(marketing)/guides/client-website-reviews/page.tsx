import { FileCodeIcon, MessagesSquareIcon, MousePointerClickIcon, PuzzleIcon } from 'lucide-react';
import { Button } from '@signalco/ui-primitives/Button';
import { brand } from '@uier/brand';
import { IntegrationLogo } from '@/src/components/app/integrations/IntegrationLogo';
import { InlineLink, PageSection, Panel, Tile } from '@/src/components/marketing/ContentPage';
import { FixVerificationSpecimen } from '@/src/components/marketing/FixVerificationSpecimen';
import { BoardSpecimen, PinnedSpecimen } from '@/src/components/marketing/LandingSpecimens';
import { CodeWindow, GuideCard, GuideHeader, GuidePicture, GuideStep, GuideSteps, StepText, Tips } from '@/src/components/marketing/guides/GuideLayout';
import { CopyableGuideText } from '@/src/components/marketing/guides/CopyableGuideText';
import { clientReviewBrief } from '@/src/lib/guides/reviewResources';
import { InstallMethodSpecimen, ReviewLinkSpecimen, SiteAddressesSpecimen, StatusFlowSpecimen, WhoCanCommentSpecimen } from '@/src/components/marketing/guides/GuideSpecimens';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import type { IntegrationProviderId } from '@/src/lib/integrations/model';
import { guides } from '@/src/lib/guides';
import { publicPageMetadata } from '@/src/lib/metadata';

export const metadata = publicPageMetadata(guides.clientReviews.path, guides.clientReviews);

// A client review from the project to the confirmed fix (docs/guides.md). The steps name the app's
// own screens; the pictures (GuideSpecimens, and the landing's and fix verification page's specimens)
// copy them. The first step keeps the id of the earlier "Prepare the review" section, so links to it
// still land at the start.

const sections = {
    create: { id: 'prepare-the-review', title: 'Create a project', number: 1 },
    install: { id: 'add-uier-to-the-site', title: `Add ${brand.name} to the site`, number: 2 },
    invite: { id: 'invite-the-client', title: 'Invite the client', number: 3 },
    share: { id: 'share-a-review-link', title: 'Share a review link', number: 4 },
    feedback: { id: 'keep-feedback-attached-to-the-page', title: 'Keep feedback attached to the page', number: 5 },
    triage: { id: 'choose-the-next-step', title: 'Choose the next step', number: 6 },
    verify: { id: 'check-the-fix-with-the-reporter', title: 'Check the fix with the reporter', number: 7 },
    brief: { id: 'agree-a-review-brief', title: 'Agree a review brief' },
    rounds: { id: 'plan-review-rounds-and-handoff', title: 'Plan review rounds and handoff' },
    integrations: { id: 'keep-the-team-s-work-in-one-place', title: 'Keep the team’s work in one place' }
};

// The services a project can connect, as the landing's IntegrationsSpecimen lists them
const services: [IntegrationProviderId, string][] = [
    ['github', 'GitHub'],
    ['linear', 'Linear'],
    ['notion', 'Notion'],
    ['azure-devops', 'Azure DevOps'],
    ['slack', 'Slack']
];

export default function ClientReviewGuide() {
    return <main className="flex flex-col pb-16">
        <GuideHeader title={guides.clientReviews.title} lead={guides.clientReviews.description} outline={Object.values(sections)}>
            <Button variant="solid" size="lg" href={KnownPages.App} className="self-start">Create a project</Button>
        </GuideHeader>

        <GuideSteps>
            <GuideStep
                {...sections.create}
                lead="Sign in and create a project for the site. Add the production or preview addresses your client will use."
                aside={<GuidePicture className="rounded-2xl border"><SiteAddressesSpecimen /></GuidePicture>}>
                <StepText muted>The toolbar works only on these addresses.</StepText>
                <StepText muted>
                    Reviewing files as well as a live site? <InlineLink href={KnownPageLinks.comparison('pastel')}>Compare {brand.name} and Pastel</InlineLink> before choosing the review workflow.
                </StepText>
            </GuideStep>

            <GuideStep
                {...sections.install}
                lead="Open the project’s installation guide and add its script tag to the site."
                aside={<GuidePicture className="rounded-2xl border"><InstallMethodSpecimen /></GuidePicture>}>
                <Tips tips={[
                    { title: 'On Next.js', icon: FileCodeIcon, text: <>The <InlineLink href={guides.nextJs.path}>Next.js guide</InlineLink> covers the App Router.</> },
                    { title: 'If you cannot change the site', icon: PuzzleIcon, text: <>Invite the client and have them use the <InlineLink href={guides.browserExtension.path}>browser extension</InlineLink> instead.</> }
                ]} />
            </GuideStep>

            <GuideStep
                {...sections.invite}
                lead="Run the installation check, then choose who can comment."
                aside={<GuidePicture className="rounded-2xl border"><WhoCanCommentSpecimen /></GuidePicture>}>
                <StepText>Invite the client in the project’s people settings, or deliberately allow guest feedback in its review settings.</StepText>
            </GuideStep>

            <GuideStep {...sections.share} lead="Share a review link from the project. Ask the client to use that address for the review.">
                <GuidePicture className="rounded-2xl border"><ReviewLinkSpecimen /></GuidePicture>
            </GuideStep>

            <GuideStep {...sections.feedback} lead="Ask for one comment per problem, on the spot it is about.">
                <GuideCard>
                    <PinnedSpecimen />
                    <Tips bare tips={[
                        { title: 'Point to the problem', icon: MousePointerClickIcon, text: 'Pin a comment to an element or select the words you want to discuss. Describe the result you expected and what happened.' },
                        { title: 'Keep one issue in a thread', icon: MessagesSquareIcon, text: 'Reply in the same thread when you need more context. Separate unrelated changes so each one can be assigned and verified.' }
                    ]} />
                </GuideCard>
            </GuideStep>

            <GuideStep {...sections.triage} lead="Assign the work, set its priority and review the inbox together.">
                <GuideCard>
                    <BoardSpecimen />
                    <p className="p-6 text-sm leading-relaxed text-muted-foreground">
                        Use <InlineLink href={KnownPages.FeedbackTriage}>feedback triage</InlineLink> when the review has many threads.
                    </p>
                </GuideCard>
            </GuideStep>

            <GuideStep {...sections.verify} lead="Marking work done and confirming the result are separate steps.">
                <StepText>
                    After the change is deployed, ask the person who reported it to verify the fix. They can confirm the fix or say it still needs work.
                    Read the <InlineLink href={KnownPages.FixVerification}>fix verification guide</InlineLink> for the available states.
                </StepText>
                <FixVerificationSpecimen />
                <GuidePicture className="rounded-2xl border py-6"><StatusFlowSpecimen /></GuidePicture>
            </GuideStep>
        </GuideSteps>

        <PageSection {...sections.brief} lead="Name the pages, journeys, environments and reviewers for this round. Agree what is outside it.">
            <StepText>Use the project&rsquo;s review brief for the instructions reviewers need. Invite named reviewers when sign-in and membership matter; choose guest links deliberately, and explain the visibility before sharing one.</StepText>
            <CopyableGuideText text={clientReviewBrief} label="Copy example review brief">
                <CodeWindow file="client-review-brief.md" label="Example client review brief" code={clientReviewBrief} />
            </CopyableGuideText>
            <StepText muted>This is a fictional brief you can adapt. The <InlineLink href={guides.reviewChecklist.path}>review checklist</InlineLink> expands the checks; the <InlineLink href={guides.bugReport.path}>bug-report template</InlineLink> helps describe each finding.</StepText>
        </PageSection>

        <PageSection {...sections.rounds} lead="These are agreed team practices, not a mandatory approval workflow enforced by uier.">
            <Panel className="lg:grid-cols-3">
                <Tile title="First round"><p>Check the agreed content and journeys. Keep one problem per thread, ask for missing context and assign the next action.</p></Tile>
                <Tile title="Fix-check round"><p>Review the deployed changes in the original environment. Request a named reviewer&rsquo;s verification where needed; ordinary Done remains available.</p></Tile>
                <Tile title="Handoff"><p>List unresolved threads, their owners, priority and the next decision. Record areas not checked. Agree the site-level acceptance separately; confirming one fix does not approve the whole release.</p></Tile>
            </Panel>
        </PageSection>

        <PageSection
            {...sections.integrations}
            lead="If your team already works in another service, choose a supported integration in the project settings.">
            <ul aria-label="Supported services" className="flex flex-wrap gap-2">
                {services.map(([id, name]) => (
                    <li key={id} className="inline-flex h-10 items-center gap-2 rounded-full border pl-1.5 pr-4 text-sm font-medium">
                        <IntegrationLogo provider={id} className="size-7 rounded-full p-1" />
                        {name}
                    </li>
                ))}
            </ul>
            <StepText>Check the <InlineLink href={KnownPages.Integrations}>integration’s</InlineLink> setup steps and permissions before connecting it.</StepText>
            <InlineLink href={KnownPages.Guides}>All guides</InlineLink>
        </PageSection>
    </main>;
}
