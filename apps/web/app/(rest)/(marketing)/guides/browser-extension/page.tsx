import { ArrowRightLeftIcon, BanIcon, CircleStopIcon, GlobeIcon, LayersIcon, LogOutIcon, MessageSquareIcon, MessageSquareOffIcon, MessageSquarePlusIcon, MonitorIcon, PlayIcon, RotateCcwIcon, SearchXIcon, UserIcon, UserXIcon, WifiOffIcon } from 'lucide-react';
import { brand } from '@uier/brand';
import { Button } from '@signalco/ui-primitives/Button';
import { CheckList, InlineLink, PageSection, Panel, Tile } from '@/src/components/marketing/ContentPage';
import { ExtensionStoreButton, FirefoxExtensionNotice } from '@/src/components/marketing/BrowserExtension';
import { GuideCard, GuideHeader, GuidePicture, GuideStep, GuideSteps, StepNumber, StepText, Tips, UiLabel as Label, type Tip } from '@/src/components/marketing/guides/GuideLayout';
import { ExtensionHeadersSpecimen, ExtensionReviewSpecimen, ExtensionSignInSpecimen, ScreenshotSpecimen } from '@/src/components/marketing/guides/GuideSpecimens';
import { KnownPages } from '@/src/knownPages';
import { extensionRelease, firefoxExtensionRelease } from '@/src/lib/extension/release';
import { guides } from '@/src/lib/guides';
import { publicPageMetadata } from '@/src/lib/metadata';

// The public setup guide for the published browser extension. Its source of truth is
// docs/browser-extension.md (design and receipts) and packages/extension (popup labels, manifests); it
// follows the app's setup tab (BrowserExtensionGuide) and docs/browser-extension-listing.md. Change
// them together, and recheck the steps, labels and pictures (GuideSpecimens) when a release changes
// the extension. Layout: docs/guides.md.

export const metadata = publicPageMetadata(guides.browserExtension.path, guides.browserExtension);

const { labels } = extensionRelease;

const sections = {
    before: { id: 'before-you-start', title: 'Before you start', number: 1 },
    install: { id: 'install', title: 'Install the extension', number: 2 },
    review: { id: 'review', title: 'Review a site', number: 3 },
    links: { id: 'comment-links', title: 'Comment links' },
    headers: { id: 'security-headers', title: 'Strict security headers' },
    screenshots: { id: 'screenshots', title: 'Screenshots' },
    problems: { id: 'common-problems', title: 'Common problems' },
    help: { id: 'help', title: 'Get help' }
};

const requirements: Tip[] = [
    {
        title: `Chrome or Edge ${extensionRelease.minimumBrowserVersion} or later`,
        icon: MonitorIcon,
        text: 'Chrome or Microsoft Edge, on a desktop computer.'
    },
    {
        title: 'Access to the project',
        icon: UserIcon,
        text: `A ${brand.name} account with access to the project, as a member or an invited reviewer. Ask a project admin to invite you if needed.`
    },
    {
        title: 'The site’s exact address',
        icon: GlobeIcon,
        text: <>An admin adds it in the project&rsquo;s settings; <code className="font-mono">https://example.com</code> and <code className="font-mono">https://www.example.com</code> are different addresses.</>
    },
    {
        title: 'Comments turned on',
        icon: MessageSquareIcon,
        text: <>Comments turned on for the project. <Label>{labels.start}</Label> stays unavailable while they are off.</>
    }
];

const installSteps = [
    <>Add the extension from the store for your browser, as described above.</>,
    <>Pin {brand.name} from the browser&rsquo;s extensions menu, or open it with <kbd className="rounded-md border px-1.5 py-0.5 font-mono text-[0.85em]">{extensionRelease.shortcut}</kbd>.</>,
    <>Open the extension and choose <Label>{labels.signIn}</Label>. Sign in to {brand.name} in the window that opens, then confirm.</>
];

const reviewSteps: Tip[] = [
    {
        title: 'Start',
        icon: PlayIcon,
        text: <>Open one of the project&rsquo;s site addresses, including staging or localhost, and sign in to the site as usual. The extension lists the projects you can access that include this exact address: choose one, then <Label>{labels.start}</Label>.</>
    },
    {
        title: 'Leave feedback',
        icon: MessageSquarePlusIcon,
        text: 'The toolbar works as it does with the script: pin a comment to an element, selected text or an area, then reply, resolve and reopen threads.'
    },
    {
        title: 'Move around',
        icon: ArrowRightLeftIcon,
        text: 'The review continues on reloads and other pages of the same site in that tab. A link to another domain, subdomain or port ends it, even when that address is in the project.'
    },
    {
        title: 'Finish',
        icon: CircleStopIcon,
        text: <>Choose <Label>{labels.exit}</Label> to remove the toolbar. Closing the tab or restarting the browser also ends the review; you stay signed in.</>
    }
];

const problems: Tip[] = [
    {
        title: 'No project includes this address',
        icon: SearchXIcon,
        text: <>The address must match exactly: http or https, the subdomain and the port. Ask a project admin to add it to the project&rsquo;s site addresses, or to invite you; admins see <Label>{labels.setup}</Label>.</>
    },
    {
        title: 'Comments are turned off',
        icon: MessageSquareOffIcon,
        text: <>A project admin turned comments off. <Label>{labels.start}</Label> stays unavailable until they turn them back on.</>
    },
    {
        title: 'This page cannot be reviewed',
        icon: BanIcon,
        text: <>Browser pages, extension stores and local files cannot be reviewed. Open the site&rsquo;s web address instead. Content inside frames from other sites cannot take comments.</>
    },
    {
        title: 'The review stopped',
        icon: RotateCcwIcon,
        text: <>You moved to another domain, subdomain or port, restarted the browser, closed the tab or chose <Label>{labels.exit}</Label>. Choose <Label>{labels.start}</Label> again.</>
    },
    {
        title: 'You were signed out',
        icon: LogOutIcon,
        text: <>The extension&rsquo;s sign-in ends after 30 days without use, a year after you signed in, or when you choose <Label>{labels.signOut}</Label>. Choose <Label>{labels.signIn}</Label> again.</>
    },
    {
        title: 'Access was removed',
        icon: UserXIcon,
        text: <>When you leave the project, or an admin removes the site address, the extension stops on its next request. Ask an admin to restore access.</>
    },
    {
        title: 'The extension could not connect',
        icon: WifiOffIcon,
        text: <>Check your connection and choose <Label>{labels.retry}</Label>. If it keeps failing, check the <InlineLink href={KnownPages.Status}>service status</InlineLink>.</>
    },
    {
        title: 'The site also has the script',
        icon: LayersIcon,
        text: <>While you review with the extension, the site&rsquo;s own toolbar steps aside, so only one is on the page.</>
    }
];

export default function BrowserExtensionGuide() {
    return (
        <main className="flex flex-col pb-16">
            <GuideHeader title={guides.browserExtension.title} lead={guides.browserExtension.description} outline={Object.values(sections)}>
                <div className="flex flex-wrap items-center gap-2.5">
                    <ExtensionStoreButton />
                    <Button variant="outlined" size="lg" href={KnownPages.BrowserExtension}>About the extension</Button>
                </div>
            </GuideHeader>

            <GuideSteps>
                <GuideStep {...sections.before} lead="The extension reviews only sites your project already includes.">
                    <Tips columns={4} tips={requirements} />
                    <div className="flex max-w-[720px] flex-col gap-2">
                        <FirefoxExtensionNotice />
                        <p className="text-sm leading-relaxed text-muted-foreground">Safari, mobile browsers and anonymous guests use the script and a review link.</p>
                    </div>
                </GuideStep>

                <GuideStep
                    {...sections.install}
                    lead="Each reviewer installs it in their own browser."
                    aside={<GuidePicture className="rounded-2xl border"><ExtensionSignInSpecimen /></GuidePicture>}>
                    <Panel className="md:grid-cols-2">
                        <Tile title="Chrome and Edge">
                            <p>Add {brand.name} from the Chrome Web Store. In Edge, allow extensions from other stores when it asks.</p>
                        </Tile>
                        <Tile title="Firefox">
                            <p>Requires desktop Firefox {firefoxExtensionRelease.minimumBrowserVersion} or later. Once its public release is available, add {brand.name} from Firefox Browser Add-ons, then follow the same steps.</p>
                        </Tile>
                    </Panel>
                    <ol className="flex flex-col gap-4">
                        {installSteps.map((step, index) => (
                            <li key={index} className="flex items-start gap-3 text-base leading-relaxed">
                                <StepNumber number={index + 1} small />
                                <span className="min-w-0">{step}</span>
                            </li>
                        ))}
                    </ol>
                    <StepText muted>
                        The extension has its own sign-in, and it stays signed in across browser restarts. <Label>{labels.signOut}</Label> ends it at once and clears the extension&rsquo;s drafts and active reviews.
                    </StepText>
                </GuideStep>

                <GuideStep {...sections.review} lead="The review stays on the site you started it on.">
                    <GuideCard>
                        <GuidePicture className="border-b"><ExtensionReviewSpecimen /></GuidePicture>
                        <Tips bare columns={4} tips={reviewSteps} />
                    </GuideCard>
                </GuideStep>
            </GuideSteps>

            <PageSection {...sections.links} lead="A shared comment opens once the review starts.">
                <StepText>
                    Open the link, then choose <Label>{labels.start}</Label>: the toolbar opens that thread. Everyone who follows a link to a site without the script needs the extension and access to the project. Guests can use review links only on sites with the script.
                </StepText>
            </PageSection>

            <PageSection {...sections.headers} lead="There is nothing to add to the site’s Content-Security-Policy.">
                <GuidePicture className="rounded-2xl border"><ExtensionHeadersSpecimen /></GuidePicture>
                <CheckList items={[
                    `The toolbar code ships inside the extension, so nothing loads from ${brand.domain} into the page.`,
                    `Requests to ${brand.domain} go through the extension, not through the page.`,
                    'Saved screenshots are drawn by the extension, so the page’s image rules do not apply.',
                    'Blocking third-party cookies does not affect it.'
                ]} />
                <StepText muted>
                    Reviews work on pages whose policy blocks scripts, connections, frames, images, fonts and styles. Adding the script instead? The install guide in the <InlineLink href={KnownPages.App}>{brand.name} app</InlineLink> lists the sources to allow.
                </StepText>
            </PageSection>

            <PageSection {...sections.screenshots} lead="Each new comment takes a screenshot of what is visible in the tab.">
                <GuidePicture className="rounded-2xl border"><ScreenshotSpecimen /></GuidePicture>
                <CheckList items={[
                    'The toolbar hides while it captures.',
                    'The image shows the part of the page the comment is about, or the whole visible page. Content outside the window is not included, so scroll to it first.',
                    <>The comment box says when a screenshot will be attached. Choose <Label>{extensionRelease.omitScreenshot}</Label> to send that comment as text only.</>,
                    'If a screenshot cannot be taken, only the text is sent.',
                    'The author can redact or replace a saved screenshot, and the same image size limits apply as with the script.'
                ]} />
            </PageSection>

            <PageSection {...sections.problems} lead="What the extension shows, and what to do.">
                <Tips tips={problems} />
            </PageSection>

            <PageSection {...sections.help} lead={<>Email <InlineLink href={`mailto:${brand.contact.email}`}>{brand.contact.email}</InlineLink> with the site address and what the extension showed.</>}>
                <StepText muted>Keep credentials and private feedback out of your message. You can also <InlineLink href={brand.issues}>report a product issue</InlineLink>.</StepText>
            </PageSection>
        </main>
    );
}
