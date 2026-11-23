import { brand } from '@uier/brand';
import { Button } from '@uier/ui-primitives/Button';
import { FileCodeIcon, GlobeIcon, ShieldCheckIcon } from 'lucide-react';
import { KnownPages } from '@/src/knownPages';
import { embedScript, cspSnippet } from '@/src/lib/app/integration';
import { guides } from '@/src/lib/guides';
import { installationGuides, installationSourcesCheckedOn, type InstallationGuideKey } from '@/src/lib/guides/installations';
import { InlineLink, PageSection } from '../ContentPage';
import { CodeWindow, GuideHeader, GuidePicture, GuideStep, GuideSteps, StepText, Tips } from './GuideLayout';
import { InstallationCheckSpecimen, ProjectCodeSpecimen } from './GuideSpecimens';

const sections = {
    prepare: { id: 'prepare-the-project', title: 'Prepare the project', number: 1 },
    place: { id: 'add-the-script', title: 'Add the script', number: 2 },
    check: { id: 'check-the-installation', title: 'Check the installation', number: 3 },
    policy: { id: 'content-security-policy', title: 'Content Security Policy' },
    version: { id: 'pin-a-toolbar-version', title: 'Pin a toolbar version' },
    removal: { id: 'remove-the-installation', title: 'Remove the installation' },
    trouble: { id: 'troubleshooting', title: 'Troubleshooting' },
    sources: { id: 'sources-and-next-steps', title: 'Sources and next steps' }
};

/** Shared installation contract, with platform-specific placement, limits and removal. Server only. */
export function PlatformInstallGuide({ platform }: { platform: InstallationGuideKey }) {
    const content = installationGuides[platform];
    const guide = guides[platform];
    const outline = { ...sections, place: { ...sections.place, title: content.placementTitle } };
    return <main className="flex flex-col pb-16">
        <GuideHeader title={guide.title} lead={guide.description} outline={Object.values(outline)}>
            <Button variant="solid" size="lg" href={KnownPages.App}>Create a project</Button>
        </GuideHeader>

        <GuideSteps>
            <GuideStep {...outline.prepare} lead={`Create a project for the ${content.name} site you will review.`}
                aside={<GuidePicture className="rounded-2xl border"><ProjectCodeSpecimen /></GuidePicture>}>
                {content.requirements.map(text => <StepText key={text}>{text}</StepText>)}
                <StepText>Add the exact production or preview addresses in Site addresses. In the project’s installation guide, copy the script with your public project code. Choose who can comment before sharing a review link.</StepText>
            </GuideStep>
            <GuideStep {...outline.place} lead={content.publish}>
                {content.placement.map(text => <StepText key={text}>{text}</StepText>)}
                <CodeWindow file={content.file} label={`${content.name} installation example`} code={embedScript(brand.url, 'YOUR_PROJECT_CODE')} />
                <StepText muted>Replace YOUR_PROJECT_CODE with the code from your project. This example uses the same snippet generator as the app. Ordinary visitors receive the small loader and a background member check; the full review interface loads when needed.</StepText>
            </GuideStep>
            <GuideStep {...outline.check} lead="Check the saved feedback, as well as the visible toolbar."
                aside={<GuidePicture className="rounded-2xl border"><InstallationCheckSpecimen /></GuidePicture>}>
                <StepText>In the project’s installation guide, run Check installation for the published address. Open the checked review link, pin a test comment and wait for Comment posted. Confirm the saved comment appears in the project.</StepText>
                <StepText>{content.navigation}</StepText>
                <StepText>Signed-in project members may see the toolbar automatically when background authentication works. Otherwise, open the review link from the app. The link starts the review; the script’s project code and access settings determine which feedback you can read or write.</StepText>
                <StepText muted>{content.surfaces}</StepText>
            </GuideStep>
        </GuideSteps>

        <PageSection {...outline.policy} lead="Keep your existing policy and merge the required sources into its matching directives.">
            <StepText>If the host, security plugin or a page meta tag sets a Content-Security-Policy, copy the sources from your project’s installation guide. These are additions, not a complete replacement policy. Keep your application’s other sources and request nonces.</StepText>
            <CodeWindow file="Content-Security-Policy sources" label={`${content.name} CSP sources`} code={cspSnippet(brand.url)} />
            <StepText muted>The app generates this list from the same source as these examples, including a configured upload origin when needed. Your site hosts the page; uier hosts the toolbar and review API. The constructed review styles need no unsafe-inline. Geist comes from uier, and the toolbar falls back to a system font if it is blocked.</StepText>
            {platform === 'webflow' && <StepText>Webflow’s custom security-header controls require Enterprise. If a proxy or an existing policy adds restrictions, the person who controls it must merge the required sources there and republish.</StepText>}
        </PageSection>

        <PageSection {...outline.version} lead="Use the default release URL, or copy a complete integrity-checked pin.">
            <StepText>The default /toolbar.js follows releases. Pin this version in the app’s installation guide provides the exact content-addressed URL and integrity value. A pinned installation gets fixes only when you replace its snippet.</StepText>
            <CodeWindow file="Pinned installation example" label={`${content.name} pinned installation example`} code={embedScript(brand.url, 'YOUR_PROJECT_CODE', 'pinned')} />
            <StepText muted>Copy the whole snippet. Production pins remain available and compatible with the review API for one year after their last release as the current version. Preview and local pins have no production retention promise.</StepText>
        </PageSection>

        <PageSection {...outline.removal} lead="Remove the source installation, then check a new page load.">
            <StepText>{content.removal}</StepText>
            <StepText>Close the old review tab and open a fresh page, then try its review link. Check that the removed script no longer loads. Removing a script does not unload an already running page or delete feedback saved in the project.</StepText>
        </PageSection>

        <PageSection {...outline.trouble} lead="Start with the published HTML and the project’s installation result.">
            <Tips columns={2} tips={content.problems.map(problem => ({ ...problem, icon: FileCodeIcon }))} />
            <Tips columns={2} tips={[
                { title: 'A different origin or project', icon: GlobeIcon, text: 'Compare the script’s project code, the current origin and Site addresses. Do not change apiUrl to your site’s origin; the toolbar needs the uier review API.' },
                { title: 'A blocked request', icon: ShieldCheckIcon, text: 'Read the installation result and browser console. Check script-src, connect-src and frame-src first, then the media, image, style and font sources the app supplies.' }
            ]} />
        </PageSection>

        <PageSection {...outline.sources} lead="Keep the installation with the person who maintains the site.">
            <StepText>Update the saved embed and this setup when your site, theme, host policy or project addresses change. Platform documentation checked on <time dateTime={installationSourcesCheckedOn}>15 November 2026</time>:</StepText>
            <ul className="flex list-disc flex-col gap-3 pl-5">
                {content.sources.map(source => <li key={source.href}><InlineLink href={source.href}>{source.title}</InlineLink></li>)}
            </ul>
            <div className="flex flex-wrap gap-4">
                <InlineLink href={guides.clientReviews.path}>Plan a client review</InlineLink>
                <InlineLink href={KnownPages.Security}>Security and permissions</InlineLink>
                {platform === 'react' && <InlineLink href={guides.nextJs.path}>Use Next.js instead</InlineLink>}
                {platform !== 'react' && <InlineLink href={guides.react.path}>Set up a React site</InlineLink>}
            </div>
        </PageSection>
    </main>;
}
