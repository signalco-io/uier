import { Button } from '@signalco/ui-primitives/Button';
import { InlineLink, NumberedList, PageHeader, PageSection, Panel, Tile } from '@/src/components/marketing/ContentPage';
import { ContextSpecimen } from '@/src/components/marketing/LandingSpecimens';
import { KnownPages } from '@/src/knownPages';
import { publicPageMetadata } from '@/src/lib/metadata';
import { useCases } from '@/src/lib/useCases';

// Sources: docs/feedback-context.md, review-workflow.md (screenshots, device details, handoff),
// recordings.md and apps/web/docs/fix-verification.md. This is a fictional reproduction example,
// not recorded telemetry. Explicit video clips do not imply session replay or console/network capture.
export const metadata = publicPageMetadata(useCases.bugReporting.path, useCases.bugReporting);

const example = [
    ['Where', 'The booking page on restaurant.example, in the staging environment.'],
    ['Expected', 'After closing the mobile menu, Book a table can be pressed.'],
    ['Actual', 'The menu closes, but the booking button remains covered.'],
    ['Steps', 'Open the booking page. Open the menu, choose Book a table, then close the menu. Try the booking button.'],
    ['Environment', 'Phone-sized window, 390 × 844. Include the actual browser and system versions when available.'],
    ['Evidence', 'A comment pinned to the booking button, the screenshot if capture succeeds, and a reviewer-started clip if the movement matters.']
];

export default function BugReportingPage() {
    return <main className="flex flex-col pb-16">
        <PageHeader
            title="Report website bugs with the context to reproduce them"
            lead="Point to the problem on the live page, describe what should happen and send the evidence a developer needs.">
            <div className="flex flex-wrap items-center gap-2.5">
                <Button variant="solid" size="lg" href={KnownPages.App}>Create a project</Button>
                <Button variant="outlined" size="lg" href={KnownPages.BugReportTemplate}>Use the bug-report template</Button>
            </div>
        </PageHeader>

        <PageSection id="example" title="A booking bug, ready to hand off" lead="A fictional report from the imaginary restaurant site.">
            <div className="overflow-hidden rounded-2xl border">
                <ContextSpecimen />
                <dl className="divide-y">
                    {example.map(([label, text]) => <div key={label} className="grid gap-2 p-5 sm:grid-cols-[100px_minmax(0,1fr)]">
                        <dt className="text-sm font-medium">{label}</dt>
                        <dd className="text-sm leading-relaxed text-muted-foreground">{text}</dd>
                    </div>)}
                </dl>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
                Keep observed facts separate from guesses. If you cannot reproduce the problem twice, say so. The <InlineLink href={KnownPages.BugReportTemplate}>report template</InlineLink> gives you a copyable starting point.
            </p>
        </PageSection>

        <PageSection id="evidence" title="Add evidence you chose to send" lead="A screenshot shows a moment. A short clip can show the steps around it.">
            <Panel>
                <Tile title="Pin and screenshot">
                    <p>Comment on an element, selected words or an area. New feedback attempts a screenshot of that spot; capture can miss images, frames, canvas and video, or fail altogether.</p>
                    <p>Members can read available browser, system and device details. Guests see the device type and window size. A screenshot alone does not establish a browser version or a cause.</p>
                </Tile>
                <Tile title="Record a short clip">
                    <p>Record screen starts only when the reviewer chooses it and selects a source in the browser. Built-in capture records video without sound for up to 60 seconds.</p>
                    <p>Upload recording accepts an MP4 or WebM clip up to 60 seconds and 25 MiB. It may keep existing audio and file metadata. Preview the clip before sending; leaving or reloading the page ends an unsent capture.</p>
                </Tile>
                <Tile title="Continue the same thread">
                    <p>Replies on the page or in the app can add an image and a recording. Ask for a missing step there, so the discussion stays with the original finding.</p>
                </Tile>
            </Panel>
            <p className="text-sm leading-relaxed text-muted-foreground">
                Capture depends on the browser, operating system, HTTPS and the reviewed site’s permissions policy. <InlineLink href={KnownPages.Screenshots}>Screenshots and context</InlineLink> describes the current limits. There is no automatic session replay, console-log capture or network-traffic recording.
            </p>
        </PageSection>

        <PageSection id="handoff" title="Give the fix a next owner" lead="The report should lead to a concrete next action.">
            <NumberedList items={[
                <>Assign the thread, set its priority and keep it in the project’s appropriate status. The assignee can reply with a question before changing code.</>,
                <>Use Copy issue to take the available context into your developer workflow, or connect a supported <InlineLink href={KnownPages.Integrations}>integration</InlineLink>. Check its permissions and synchronization scope before enabling it.</>,
                <>A coding tool can read authorized feedback through the <InlineLink href={KnownPages.Ai}>MCP connector</InlineLink>. Access and writes depend on its granted operations and your coding tool’s approvals.</>,
                <>Reply with the change and where it was deployed. Reproduce the original steps again in that environment, rather than assuming a closed tracker issue proves the result.</>
            ]} />
        </PageSection>

        <PageSection id="privacy" title="Keep private details out of the report" lead="Check the page and the evidence before sending.">
            <Panel>
                <Tile title="Choose the image">
                    <p>The comment form shows the screenshot as a thumbnail you can preview. Remove it before posting if the area contains private information, or attach an image you prepared yourself.</p>
                    <p>Redact screenshot changes an already saved image. It is not automatic masking before upload, and it cannot remove downloaded copies.</p>
                </Tile>
                <Tile title="Review the clip and the text">
                    <p>Leave out credentials, customer records and private URL parameters. Review the whole clip, including any uploaded audio, before sending. Video redaction is not available.</p>
                    <p>Agree who can see the project and thread. The <InlineLink href={KnownPages.Security}>security page</InlineLink> and <InlineLink href={KnownPages.LegalPrivacyPolicy}>privacy policy</InlineLink> describe access and storage.</p>
                </Tile>
            </Panel>
        </PageSection>

        <PageSection id="retest" title="Check the result with the reporter" lead="Done is ordinary completion. Reviewer confirmation is a separate choice.">
            <p className="text-sm leading-relaxed text-muted-foreground">
                Fix verification is off by default. After an admin enables it in Project settings → Review, a member can request an optional check on an individual thread. The chosen reviewer confirms the result or says it still needs work; a decision by another admin is labeled as an override.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
                Ordinary Done, bulk Done, an integration closing its issue and an MCP status change do not count as that confirmation. Read <InlineLink href={KnownPages.FixVerification}>fix verification</InlineLink> for the actor rules, or plan a wider <InlineLink href={KnownPages.UserAcceptanceTesting}>manual acceptance review</InlineLink>.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
                For a client round, start with the <InlineLink href={KnownPages.ClientFeedback}>client-feedback workflow</InlineLink> and the <InlineLink href={KnownPages.ClientReviewGuide}>setup guide</InlineLink>.
            </p>
            <Button variant="solid" size="lg" href={KnownPages.App} className="self-start">Start collecting bug reports</Button>
        </PageSection>
    </main>;
}
