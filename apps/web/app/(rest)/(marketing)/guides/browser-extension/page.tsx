import { brand } from '@uier/brand';
import { Button } from '@signalco/ui-primitives/Button';
import { CheckList, InlineLink, PageHeader, PageSection, Panel, Tile } from '@/src/components/marketing/ContentPage';
import { ExtensionStoreButton } from '@/src/components/marketing/BrowserExtension';
import { KnownPages } from '@/src/knownPages';
import { extensionRelease } from '@/src/lib/extension/release';
import { guides } from '@/src/lib/guides';
import { publicPageMetadata } from '@/src/lib/metadata';

// The public setup guide for the published browser extension. Its source of truth is
// docs/browser-extension.md (design and receipts) and apps/extension (popup labels, manifest); it
// follows the app's setup tab (BrowserExtensionGuide) and docs/browser-extension-listing.md. Change
// them together, and recheck the steps and labels when a release changes the extension.

export const metadata = publicPageMetadata(guides.browserExtension.path, guides.browserExtension);

const { labels } = extensionRelease;

function Label({ children }: { children: string; }) {
    return <strong className="font-semibold">{children}</strong>;
}

const problems = [
    {
        title: 'No project includes this address',
        text: <>The address must match exactly: http or https, the subdomain and the port. Ask a project admin to add it to the project&rsquo;s site addresses, or to invite you; admins see <Label>{labels.setup}</Label>.</>
    },
    {
        title: 'Comments are turned off',
        text: <>A project admin turned comments off. <Label>{labels.start}</Label> stays unavailable until they turn them back on.</>
    },
    {
        title: 'This page cannot be reviewed',
        text: <>Browser pages, extension stores and local files cannot be reviewed. Open the site&rsquo;s web address instead. Content inside frames from other sites cannot take comments.</>
    },
    {
        title: 'The review stopped',
        text: <>You moved to another domain, subdomain or port, restarted the browser, closed the tab or chose <Label>{labels.exit}</Label>. Choose <Label>{labels.start}</Label> again.</>
    },
    {
        title: 'You were signed out',
        text: <>The extension&rsquo;s sign-in ends after 30 days without use, a year after you signed in, or when you choose <Label>{labels.signOut}</Label>. Choose <Label>{labels.signIn}</Label> again.</>
    },
    {
        title: 'Access was removed',
        text: <>When you leave the project, or an admin removes the site address, the extension stops on its next request. Ask an admin to restore access.</>
    },
    {
        title: 'The extension could not connect',
        text: <>Check your connection and choose <Label>{labels.retry}</Label>. If it keeps failing, check the <InlineLink href={KnownPages.Status}>service status</InlineLink>.</>
    },
    {
        title: 'The site also has the script',
        text: <>While you review with the extension, the site&rsquo;s own toolbar steps aside, so only one is on the page.</>
    }
];

export default function BrowserExtensionGuide() {
    return (
        <main className="flex flex-col pb-16">
            <PageHeader title={guides.browserExtension.title} lead={guides.browserExtension.description}>
                <div className="flex flex-wrap items-center gap-2.5">
                    <ExtensionStoreButton />
                    <Button variant="outlined" size="lg" href={KnownPages.BrowserExtension}>About the extension</Button>
                </div>
            </PageHeader>

            <PageSection id="before-you-start" title="Before you start" lead="The extension reviews only sites your project already includes.">
                <CheckList items={[
                    `Chrome or Microsoft Edge ${extensionRelease.minimumBrowserVersion} or later, on a desktop computer.`,
                    `A ${brand.name} account with access to the project, as a member or an invited reviewer. Ask a project admin to invite you if needed.`,
                    <>The site&rsquo;s exact address in the project. An admin adds it in the project&rsquo;s settings; <code className="font-mono">https://example.com</code> and <code className="font-mono">https://www.example.com</code> are different addresses.</>,
                    'Comments turned on for the project.'
                ]} />
                <p className="text-sm leading-relaxed text-muted-foreground">Firefox, Safari, mobile browsers and anonymous guests are not supported. They review through the script and a review link.</p>
            </PageSection>

            <PageSection id="install" title="Install the extension" lead="Each reviewer installs it in their own browser.">
                <ol className="flex list-decimal flex-col gap-4 pl-5 text-base leading-relaxed">
                    <li className="pl-2">Open the {brand.name} extension in the Chrome Web Store and add it to your browser. In Edge, allow extensions from other stores when it asks.</li>
                    <li className="pl-2">Pin {brand.name} from the browser&rsquo;s extensions menu, or open it with <kbd className="font-mono">{extensionRelease.shortcut}</kbd>.</li>
                    <li className="pl-2">Open the extension and choose <Label>{labels.signIn}</Label>. Sign in to {brand.name} in the window that opens, then confirm.</li>
                </ol>
                <p className="text-sm leading-relaxed text-muted-foreground">The extension has its own sign-in, and it stays signed in across browser restarts. <Label>{labels.signOut}</Label> ends it at once and clears the extension&rsquo;s drafts and active reviews.</p>
            </PageSection>

            <PageSection id="review" title="Review a site" lead="The review stays on the site you started it on.">
                <Panel className="md:grid-cols-2">
                    <Tile title="Start">
                        <p>Open one of the project&rsquo;s site addresses, including staging or localhost, and sign in to the site as you normally would. Open the extension: it lists the projects you can access that include this exact address. Choose one when several match, then <Label>{labels.start}</Label>.</p>
                    </Tile>
                    <Tile title="Leave feedback">
                        <p>The toolbar works as it does with the script: pin a comment to an element, selected text or an area, then reply, resolve and reopen threads.</p>
                    </Tile>
                    <Tile title="Move around">
                        <p>The review continues on reloads and other pages of the same site in that tab. A link to another domain, subdomain or port ends it, even when that address is in the project.</p>
                    </Tile>
                    <Tile title="Finish">
                        <p>Choose <Label>{labels.exit}</Label> to remove the toolbar. Closing the tab or restarting the browser also ends the review; you stay signed in.</p>
                    </Tile>
                </Panel>
            </PageSection>

            <PageSection id="comment-links" title="Comment links" lead="A shared comment opens once the review starts.">
                <p className="text-base leading-relaxed">Open the link, then choose <Label>{labels.start}</Label>: the toolbar opens that thread. Everyone who follows a link to a site without the script needs the extension and access to the project. Guests can use review links only on sites with the script.</p>
            </PageSection>

            <PageSection id="security-headers" title="Strict security headers" lead="There is nothing to add to the site’s Content-Security-Policy.">
                <CheckList items={[
                    `The toolbar code ships inside the extension, so nothing loads from ${brand.domain} into the page.`,
                    `Requests to ${brand.domain} go through the extension, not through the page.`,
                    'Saved screenshots are drawn by the extension, so the page’s image rules do not apply.',
                    'Blocking third-party cookies does not affect it.'
                ]} />
                <p className="text-sm leading-relaxed text-muted-foreground">Reviews work on pages whose policy blocks scripts, connections, frames, images, fonts and styles. Adding the script instead? The install guide in the <InlineLink href={KnownPages.App}>{brand.name} app</InlineLink> lists the sources to allow.</p>
            </PageSection>

            <PageSection id="screenshots" title="Screenshots" lead="Each new comment takes a screenshot of what is visible in the tab.">
                <p className="text-base leading-relaxed">The toolbar hides while it captures. The image shows the part of the page the comment is about, or the whole visible page. Content outside the window is not included, so scroll to it first. The comment box says when a screenshot will be attached; choose <Label>{extensionRelease.omitScreenshot}</Label> to send that comment as text only. If a screenshot cannot be taken, only the text is sent. The author can redact or replace a saved screenshot, and the same image size limits apply as with the script.</p>
            </PageSection>

            <PageSection id="common-problems" title="Common problems" lead="What the extension shows, and what to do.">
                <Panel className="md:grid-cols-2">
                    {problems.map(problem => (
                        <Tile key={problem.title} title={problem.title}>
                            <p>{problem.text}</p>
                        </Tile>
                    ))}
                </Panel>
            </PageSection>

            <PageSection id="help" title="Get help" lead={<>Email <InlineLink href={`mailto:${brand.contact.email}`}>{brand.contact.email}</InlineLink> with the site address and what the extension showed.</>}>
                <p className="text-sm leading-relaxed text-muted-foreground">Keep credentials and private feedback out of your message. You can also <InlineLink href={brand.issues}>report a product issue</InlineLink>.</p>
            </PageSection>
        </main>
    );
}
