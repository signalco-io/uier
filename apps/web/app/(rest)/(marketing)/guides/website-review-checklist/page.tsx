import { Button } from '@signalco/ui-primitives/Button';
import { InlineLink, PageSection, Panel, Tile } from '@/src/components/marketing/ContentPage';
import { CodeWindow, GuideHeader, GuidePicture, GuideStep, GuideSteps, StepText } from '@/src/components/marketing/guides/GuideLayout';
import { CopyableGuideText } from '@/src/components/marketing/guides/CopyableGuideText';
import { ReviewChecklistSpecimen } from '@/src/components/marketing/guides/PracticalReviewSpecimens';
import { PinnedSpecimen, BoardSpecimen } from '@/src/components/marketing/LandingSpecimens';
import { guides } from '@/src/lib/guides';
import { websiteReviewChecklist } from '@/src/lib/guides/reviewResources';
import { publicPageMetadata } from '@/src/lib/metadata';
import { KnownPages } from '@/src/knownPages';

export const metadata = publicPageMetadata(guides.reviewChecklist.path, guides.reviewChecklist);
const sections = {
    scope: { id: 'agree-the-scope', title: 'Agree the scope', number: 1 },
    check: { id: 'work-through-the-page', title: 'Work through the page', number: 2 },
    report: { id: 'report-each-finding', title: 'Report each finding', number: 3 },
    handoff: { id: 'handoff-and-retest', title: 'Hand off and retest', number: 4 },
    template: { id: 'copy-the-checklist', title: 'The checklist' },
    example: { id: 'filled-review-example', title: 'A filled review example' }
};

export default function ReviewChecklistPage() {
    return <main className="flex min-w-0 flex-col pb-16">
        <GuideHeader title={guides.reviewChecklist.title} lead={guides.reviewChecklist.description} outline={Object.values(sections)}>
            <Button variant="solid" size="lg" href={KnownPages.App}>Create a project</Button>
        </GuideHeader>
        <GuideSteps>
            <GuideStep {...sections.scope} lead="Choose pages, journeys, reviewers and environments before starting. Name what is outside this round."
                aside={<GuidePicture className="rounded-2xl border"><ReviewChecklistSpecimen /></GuidePicture>}>
                <StepText>For example, review an imaginary restaurant&rsquo;s menu and booking journey on staging, at narrow and wide widths, with a keyboard pass.</StepText>
                <StepText muted>The <InlineLink href={KnownPages.ClientReviewGuide}>client-review guide</InlineLink> includes a brief and review-round plan.</StepText>
            </GuideStep>
            <GuideStep {...sections.check} lead="Check the content, then the layout and the actions people need to finish.">
                <Panel className="md:grid-cols-2">
                    <Tile title="Content and layout"><p>Check copy, links, meaningful image descriptions, long text, empty states and hierarchy. Compare the page with the agreed content.</p></Tile>
                    <Tile title="Responsive behavior"><p>Use narrow and wide viewports, zoom and touch where available. Open menus and dialogs; look for clipped controls and unintended horizontal scrolling.</p></Tile>
                    <Tile title="Interactions"><p>Follow navigation and forms through success, validation errors and recovery. Use test data and a safe environment.</p></Tile>
                    <Tile title="Accessibility"><p>Try keyboard navigation, visible focus, labels and readable content. Use agreed assistive-technology checks and record what you did not check.</p></Tile>
                </Panel>
                <StepText muted><InlineLink href={KnownPages.PageChecks}>In-browser page checks</InlineLink> can help find issues. This human checklist is not accessibility certification or a security audit; an automated pass cannot establish either.</StepText>
            </GuideStep>
            <GuideStep {...sections.report} lead="Leave one problem per thread, at the element, words or area it concerns.">
                <PinnedSpecimen />
                <StepText>Record expected and actual results, reproducible steps and the correct page/environment. Check a screenshot for sensitive content before posting; capture and browser details can be unavailable.</StepText>
                <InlineLink href={guides.bugReport.path}>Use the bug-report template</InlineLink>
            </GuideStep>
            <GuideStep {...sections.handoff} lead="Give each unresolved finding an owner and a next action. Repeat its original steps after deployment.">
                <BoardSpecimen />
                <StepText muted><InlineLink href={KnownPages.FeedbackTriage}>Triage</InlineLink> keeps work manageable. Optional <InlineLink href={KnownPages.FixVerification}>fix verification</InlineLink> asks a named reviewer to check one thread; ordinary Done does not approve the whole site.</StepText>
            </GuideStep>
        </GuideSteps>
        <PageSection {...sections.template} lead="Copy this into your review notes. Record Pass, Finding or Not checked, rather than treating unchecked areas as passed.">
            <CopyableGuideText text={websiteReviewChecklist} label="Copy review checklist">
                <CodeWindow file="website-review.md" label="Website review checklist text" code={websiteReviewChecklist} />
            </CopyableGuideText>
        </PageSection>
        <PageSection {...sections.example} lead="A fictional first round for a restaurant site, not a measured customer result.">
            <Panel as="dl">
                {[
                    ['Scope', 'Staging menu and booking pages; 390 px and 1440 px viewports; keyboard navigation. Payments and security testing excluded.'],
                    ['Content and layout', 'Pass for the agreed menu copy; finding: the long dish name clips at the narrow width.'],
                    ['Interaction and accessibility', 'Finding: the booking menu hides the confirmation. Keyboard focus checked; screen-reader behavior not checked in this round.'],
                    ['Handoff', 'One thread for each finding, assigned for correction. The original reviewers will repeat the same steps after the staging fix.']
                ].map(([label, text]) => <div key={label} className="flex flex-col gap-2 p-6"><dt className="font-medium">{label}</dt><dd className="text-sm leading-relaxed text-muted-foreground">{text}</dd></div>)}
            </Panel>
            <InlineLink href={KnownPages.NextJsGuide}>Install uier on a Next.js site</InlineLink>
        </PageSection>
    </main>;
}
