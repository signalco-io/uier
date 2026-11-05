import { Button } from '@signalco/ui-primitives/Button';
import { PageHeader, PageSection, Panel, Tile, InlineLink } from '@/src/components/marketing/ContentPage';
import { publicPageMetadata } from '@/src/lib/metadata';
import { guides } from '@/src/lib/guides';
import { KnownPages } from '@/src/knownPages';

export const metadata = publicPageMetadata(guides.clientReviews.path, guides.clientReviews);

export default function ClientReviewGuide() {
    return <main className="flex flex-col pb-16">
        <PageHeader title={guides.clientReviews.title} lead={guides.clientReviews.description}>
            <Button variant="solid" href={KnownPages.App}>Create a project</Button>
        </PageHeader>
        <PageSection id="prepare-the-review" title="Prepare the review" lead="Use a project for the site you want to review.">
            <ol className="flex list-decimal flex-col gap-4 pl-5 text-base leading-relaxed">
                <li>Sign in and create a project. Add the production or preview addresses your client will use.</li>
                <li>Open the project’s installation guide and add its script tag to the site. The <InlineLink href={guides.nextJs.path}>Next.js guide</InlineLink> covers the App Router. If you cannot change the site, invite the client and have them use the <InlineLink href={guides.browserExtension.path}>browser extension</InlineLink> instead.</li>
                <li>Run the installation check. Use the project’s people settings to invite the client, or deliberately allow guest feedback in its review settings.</li>
                <li>Share a review link from the project. Ask the client to use that address for the review.</li>
            </ol>
        </PageSection>
        <PageSection id="keep-feedback-attached-to-the-page" title="Keep feedback attached to the page" wide>
            <Panel>
                <Tile title="Point to the problem"><p>Pin a comment to an element or select the words you want to discuss. Describe the result you expected and what happened.</p></Tile>
                <Tile title="Keep one issue in a thread"><p>Reply in the same thread when you need more context. Separate unrelated changes so each one can be assigned and verified.</p></Tile>
                <Tile title="Choose the next step"><p>Assign the work, set its priority and review the inbox together. Use <InlineLink href={KnownPages.FeedbackTriage}>feedback triage</InlineLink> when the review has many threads.</p></Tile>
            </Panel>
        </PageSection>
        <PageSection id="check-the-fix-with-the-reporter" title="Check the fix with the reporter" lead="Marking work done and confirming the result are separate steps.">
            <p className="text-base leading-relaxed">After the change is deployed, ask the person who reported it to verify the fix. They can confirm it or reopen the discussion. Read the <InlineLink href={KnownPages.FixVerification}>fix verification guide</InlineLink> for the available states.</p>
        </PageSection>
        <PageSection id="keep-the-team-s-work-in-one-place" title="Keep the team’s work in one place">
            <p className="text-base leading-relaxed">If your team already works in another service, choose a supported <InlineLink href={KnownPages.Integrations}>integration</InlineLink> in the project settings. Check its setup steps and permissions before connecting it.</p>
            <InlineLink href={KnownPages.Guides}>All guides</InlineLink>
        </PageSection>
    </main>;
}
