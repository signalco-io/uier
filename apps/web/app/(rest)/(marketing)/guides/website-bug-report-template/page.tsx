import { Button } from '@signalco/ui-primitives/Button';
import { InlineLink, PageSection, Panel, Tile } from '@/src/components/marketing/ContentPage';
import { CodeWindow, GuideHeader, GuidePicture, GuideStep, GuideSteps, StepText } from '@/src/components/marketing/guides/GuideLayout';
import { CopyableGuideText } from '@/src/components/marketing/guides/CopyableGuideText';
import { BugReportSpecimen } from '@/src/components/marketing/guides/PracticalReviewSpecimens';
import { PinnedSpecimen } from '@/src/components/marketing/LandingSpecimens';
import { guides } from '@/src/lib/guides';
import { bugReportExample, bugReportTemplate } from '@/src/lib/guides/reviewResources';
import { publicPageMetadata } from '@/src/lib/metadata';
import { KnownPages } from '@/src/knownPages';

export const metadata = publicPageMetadata(guides.bugReport.path, guides.bugReport);
const sections = {
    observe: { id: 'describe-one-problem', title: 'Describe one problem', number: 1 },
    template: { id: 'write-the-report', title: 'Write the report', number: 2 },
    handoff: { id: 'hand-it-to-the-developer', title: 'Hand it to the developer', number: 3 },
    example: { id: 'filled-bug-report', title: 'A filled bug report' },
    verify: { id: 'check-the-fix', title: 'Check the fix' }
};

export default function BugReportTemplatePage() {
    return <main className="flex min-w-0 flex-col pb-16">
        <GuideHeader title={guides.bugReport.title} lead={guides.bugReport.description} outline={Object.values(sections)}>
            <Button variant="solid" size="lg" href={KnownPages.App}>Create a project</Button>
        </GuideHeader>
        <GuideSteps>
            <GuideStep {...sections.observe} lead="Describe what you saw and what you expected, on the page where it happened."
                aside={<GuidePicture className="rounded-2xl border"><BugReportSpecimen /></GuidePicture>}>
                <StepText>Keep unrelated problems in separate threads. Record the environment and starting state; a clear sequence is more useful than &ldquo;it is broken&rdquo;.</StepText>
            </GuideStep>
            <GuideStep {...sections.template} lead="Copy the template and replace its placeholders with the details you actually know.">
                <CopyableGuideText text={bugReportTemplate} label="Copy bug report template">
                    <CodeWindow file="bug-report.md" label="Bug report template text" code={bugReportTemplate} />
                </CopyableGuideText>
                <StepText muted>Write &ldquo;unknown&rdquo; when context is unavailable. uier does not record session replay, console logs or network traffic. A screenshot attempt can fail; check visible sensitive content before attaching an image.</StepText>
            </GuideStep>
            <GuideStep {...sections.handoff} lead="Save the feedback, then share the authorized thread or choose Copy issue for its current Markdown context.">
                <PinnedSpecimen />
                <Panel className="md:grid-cols-2">
                    <Tile title="Keep the discussion together"><p>Reply in the app or toolbar inbox when someone needs more detail. A saved thread keeps its page, anchor and permitted context together.</p></Tile>
                    <Tile title="Choose the destination"><p>Paste Copy issue into the tool your team uses, or configure an <InlineLink href={KnownPages.Integrations}>integration</InlineLink>. Check its verified scope and setup; outside recipients keep their own copies.</p></Tile>
                </Panel>
                <StepText muted>Only authorized members see detailed reproduction context. A copied report is not automatic diagnosis or a promise that another person can access its protected screenshot.</StepText>
            </GuideStep>
        </GuideSteps>
        <PageSection {...sections.example} lead="A fictional booking-form problem, showing the structure rather than invented captured telemetry.">
            <CodeWindow file="booking-example.md" label="Filled bug report example" code={bugReportExample} />
        </PageSection>
        <PageSection {...sections.verify} lead="After the change is deployed, repeat the original steps in the same environment.">
            <StepText>When needed, a project member can request <InlineLink href={KnownPages.FixVerification}>verification from a named reviewer</InlineLink>. The reviewer chooses Confirm fix or Still needs work. Ordinary Done and an admin override are separate outcomes.</StepText>
            <StepText muted>For a broader round, use the <InlineLink href={guides.reviewChecklist.path}>website review checklist</InlineLink> and <InlineLink href={KnownPages.ClientReviewGuide}>client-review guide</InlineLink>.</StepText>
        </PageSection>
    </main>;
}
