import { CheckIcon, CodeIcon, GlobeIcon, ShieldCheckIcon } from 'lucide-react';
import { brand } from '@uier/brand';
import { Button } from '@signalco/ui-primitives/Button';
import { InlineLink, PageSection } from '@/src/components/marketing/ContentPage';
import { CodeWindow, GuideHeader, GuidePicture, GuideStep, GuideSteps, StepText, Tips } from '@/src/components/marketing/guides/GuideLayout';
import { InstallationCheckSpecimen, ProjectCodeSpecimen } from '@/src/components/marketing/guides/GuideSpecimens';
import { publicPageMetadata } from '@/src/lib/metadata';
import { guides } from '@/src/lib/guides';
import { nextJsSnippet } from '@/src/lib/app/integration';
import { KnownPages } from '@/src/knownPages';

export const metadata = publicPageMetadata(guides.nextJs.path, guides.nextJs);

// Installing the toolbar in a Next.js App Router site (docs/guides.md). The example is the snippet
// generator of the project's install guide (nextJsSnippet), so the two never differ.

const sections = {
    create: { id: 'create-the-project', title: 'Create the project', number: 1 },
    add: { id: 'add-the-script-to-your-root-layout', title: 'Add the script to your root layout', number: 2 },
    check: { id: 'check-the-installation', title: 'Check the installation', number: 3 },
    troubleshoot: { id: 'if-the-toolbar-does-not-load', title: 'If the toolbar does not load' }
};

const checks = [
    'Deploy the layout change to an address configured in the project.',
    `Run the installation check from ${brand.name} and open the review link it provides.`,
    'Pin a test comment, open the inbox, and check that the comment appears in the project.',
    'Navigate to another page on the site and check the toolbar there too.'
];

export default function NextJsGuide() {
    return <main className="flex flex-col pb-16">
        <GuideHeader title={guides.nextJs.title} lead={guides.nextJs.description} outline={Object.values(sections)}>
            <Button variant="solid" size="lg" href={KnownPages.App}>Create a project</Button>
        </GuideHeader>

        <GuideSteps>
            <GuideStep
                {...sections.create}
                lead={`Sign in to ${brand.name}, create a project for your site and add the exact production or preview addresses you will review.`}
                aside={<GuidePicture className="rounded-2xl border"><ProjectCodeSpecimen /></GuidePicture>}>
                <StepText>Open the project’s installation guide and copy the project code from the script tag shown there.</StepText>
            </GuideStep>

            <GuideStep {...sections.add} lead="Use next/script inside the App Router’s body element.">
                <StepText>
                    Keep your existing layout and its children. Add the Script element below the children, replacing <code className="font-mono text-[0.9em]">YOUR_PROJECT_CODE</code> with the code from your project.
                </StepText>
                <CodeWindow
                    file="app/layout.tsx"
                    label="Next.js installation example"
                    code={nextJsSnippet(brand.url, 'YOUR_PROJECT_CODE')}
                    highlight={line => line.startsWith('<Script')} />
                <StepText muted>This example comes from the same snippet generator as the project’s installation guide. It loads the toolbar after the page becomes interactive.</StepText>
            </GuideStep>

            <GuideStep {...sections.check} lead="Deploy the change, then check it on the live site.">
                <ol className="flex max-w-[720px] flex-col gap-3">
                    {checks.map(check => (
                        <li key={check} className="flex items-start gap-3 text-base leading-relaxed">
                            <span aria-hidden="true" className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border">
                                <CheckIcon size={12} strokeWidth={2} />
                            </span>
                            {check}
                        </li>
                    ))}
                </ol>
                <GuidePicture className="rounded-2xl border"><InstallationCheckSpecimen /></GuidePicture>
            </GuideStep>
        </GuideSteps>

        <PageSection {...sections.troubleshoot} lead="Start with the project address and your browser’s console.">
            <Tips columns={3} tips={[
                { title: 'The project code', icon: CodeIcon, text: 'Confirm that the script uses the copied project code.' },
                { title: 'The site address', icon: GlobeIcon, text: 'Confirm that the current site address is configured in that project.' },
                { title: 'Content Security Policy', icon: ShieldCheckIcon, text: 'If the site sends one, merge the sources shown in the installation guide into the existing directives. Keep any request nonces your app already requires.' }
            ]} />
            <StepText muted>The script tag loads the toolbar. Project access settings still determine who can review the site.</StepText>
            <InlineLink href={guides.clientReviews.path}>Plan a client review</InlineLink>
        </PageSection>
    </main>;
}
