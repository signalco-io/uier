import { Button } from '@uier/ui-primitives/Button';
import { brand } from '@uier/brand';
import { InlineLink, NumberedList, PageHeader, PageSection, Panel, StepsPanel, Tile } from '@/src/components/marketing/ContentPage';
import { PinnedSpecimen } from '@/src/components/marketing/LandingSpecimens';
import { KnownPages } from '@/src/knownPages';
import { publicPageMetadata } from '@/src/lib/metadata';
import { useCases } from '@/src/lib/useCases';

// Sources: docs/review-workflow.md (projects, clients, review links and permissions),
// apps/web/docs/project-review-briefs.md and fix-verification.md (project opt-in).
// The restaurant example is fictional. Team review rounds are not a required approval workflow.
export const metadata = publicPageMetadata(useCases.clientFeedback.path, useCases.clientFeedback);

const steps = [
    { title: 'Prepare the project', text: 'Create a project for the site and add the production and preview addresses that belong to this review. Group projects under a client when you manage several sites.' },
    { title: 'Agree the brief', text: 'Name the pages, journeys and people for this round in the project’s review brief. Say what is outside the review and when the team will discuss the findings.' },
    { title: 'Give reviewers access', text: 'Add the script and check installation, then invite the client or deliberately allow guests. Share a review link for the environment you want checked.' },
    { title: 'Discuss one finding at a time', text: 'Pin each comment to the element, area or words it concerns. Reply in that thread to settle the wording or ask for the missing detail.' },
    { title: 'Assign the next change', text: 'Give the thread an owner and a priority. Follow the work in the project’s list or board, then return to the reviewed page after the change is deployed.' }
];

export default function ClientFeedbackPage() {
    return <main className="flex flex-col pb-16">
        <PageHeader
            title="Collect client feedback on the live site"
            lead="Let clients point to what they mean, keep the discussion beside it and give each next change an owner.">
            <div className="flex flex-wrap items-center gap-2.5">
                <Button variant="solid" size="lg" href={KnownPages.App}>Create a project</Button>
                <Button variant="outlined" size="lg" href={KnownPages.ClientReviewGuide}>Plan a client review</Button>
            </div>
        </PageHeader>

        <PageSection id="example" title="A comment everyone can find" lead="An example from an imaginary restaurant site.">
            <figure className="overflow-hidden rounded-2xl border">
                <PinnedSpecimen />
                <figcaption className="p-6 text-sm leading-relaxed text-muted-foreground">
                    Mia notices that Sunday still says Closed. She comments on that row: “We open on Sundays now. Can this say 12–22?” The thread stays with the hours while the team discusses the change.
                </figcaption>
            </figure>
            <p className="text-sm leading-relaxed text-muted-foreground">
                The developer can ask which date the new hours start, assign the change and reply with the deployed fix. A separate problem with the map gets its own thread.
                <InlineLink href={KnownPages.PinnedComments}> Pinned comments</InlineLink> explains how a pin follows the page and what happens when its element disappears.
            </p>
        </PageSection>

        <PageSection id="review-round" title="One round, from brief to handoff" lead="Agree the scope before asking people to review.">
            <StepsPanel steps={steps} />
            <p className="text-sm leading-relaxed text-muted-foreground">
                The <InlineLink href={KnownPages.ClientReviewGuide}>client-review guide</InlineLink> walks through installation, invitations, review links and handoff. If the team cannot add the script, invited reviewers can use the supported <InlineLink href={KnownPages.BrowserExtension}>browser extension</InlineLink>.
            </p>
        </PageSection>

        <PageSection id="access" title="Choose who takes part" lead="A review link opens the toolbar. The project’s access settings decide who can use it.">
            <Panel>
                <Tile title="Invited reviewers">
                    <p>Invite named people when membership and sign-in matter. Reviewers sign in before commenting on a project limited to invited people.</p>
                </Tile>
                <Tile title="Guests, when you choose them">
                    <p>Anyone with the link allows guest comments under a visitor identity. Explain the review’s visibility before sharing it, and keep personal details out of shared feedback.</p>
                </Tile>
                <Tile title="Several clients and sites">
                    <p>Use a project for each review scope and client grouping to find related sites. Check project membership and configured addresses for each one; a client label does not grant access.</p>
                </Tile>
            </Panel>
            <p className="text-sm leading-relaxed text-muted-foreground">
                A workspace admin can make a thread private to its author and workspace admins. That is a thread setting, not a substitute for agreeing access to the client’s site. The <InlineLink href={KnownPages.Security}>security page</InlineLink> describes the access boundaries.
            </p>
        </PageSection>

        <PageSection id="evidence" title="Send the context the review needs" lead="Leave out sensitive information before posting.">
            <NumberedList items={[
                <>New feedback attempts a screenshot and shows it as a thumbnail you can preview. Select <strong className="font-medium">Remove screenshot</strong> if that part of the page is private.</>,
                <>A reply can carry an image or a short recording when the question needs more context. Review a recorded clip before sending it.</>,
                <>Redact screenshot covers details in an already saved image. It cannot recall copies someone has downloaded.</>
            ]} />
            <p className="text-sm leading-relaxed text-muted-foreground">
                <InlineLink href={KnownPages.Screenshots}>Screenshots and context</InlineLink> covers capture limits and browser details. The <InlineLink href={KnownPages.LegalPrivacyPolicy}>privacy policy</InlineLink> explains storage and sharing.
            </p>
        </PageSection>

        <PageSection id="handoff" title="Check the result, then close the round" lead="Completing a thread and accepting a whole site are separate decisions.">
            <Panel>
                <Tile title="Keep the next action visible">
                    <p>Use the project’s statuses, assignees and priorities to show what remains. <InlineLink href={KnownPages.FeedbackTriage}>Triage</InlineLink> helps with a larger review; a supported <InlineLink href={KnownPages.Integrations}>integration</InlineLink> can hand findings to the service your team uses.</p>
                </Tile>
                <Tile title="Ask for a fix check where needed">
                    <p>An admin first enables fix verification in Project settings → Review. It is off by default. A member can then request an optional check on one thread from an eligible reviewer, usually its author.</p>
                    <p>A guest checks their own feedback using the same visitor identity while guest access remains allowed. Ordinary Done and connected-service closure do not record reviewer confirmation; an admin’s decision on someone else’s behalf is labeled as an override.</p>
                </Tile>
                <Tile title="Agree the site-level decision">
                    <p>List unresolved findings, owners and anything the team did not check. Confirming one fix does not approve a release. The <InlineLink href={KnownPages.UserAcceptanceTesting}>manual acceptance-review workflow</InlineLink> helps plan that wider conversation.</p>
                </Tile>
            </Panel>
            <p className="text-sm leading-relaxed text-muted-foreground">
                Read the <InlineLink href={KnownPages.FixVerification}>fix-verification rules</InlineLink>, or use the <InlineLink href={KnownPages.BugReporting}>bug-reporting workflow</InlineLink> when a finding needs reproduction steps.
            </p>
            <p className="text-sm text-muted-foreground">{brand.pricing}</p>
            <Button variant="solid" size="lg" href={KnownPages.App} className="self-start">Start a client review</Button>
        </PageSection>
    </main>;
}
