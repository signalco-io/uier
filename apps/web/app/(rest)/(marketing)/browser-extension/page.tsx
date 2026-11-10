import { Button } from '@signalco/ui-primitives/Button';
import { brand } from '@uier/brand';
import { CheckList, Chip, InlineLink, PageHeader, PageSection, Panel, Tile } from '../../../../src/components/marketing/ContentPage';
import { ExtensionStoreButton, FirefoxExtensionNotice, extensionPage } from '../../../../src/components/marketing/BrowserExtension';
import { ExtensionSpecimens } from '../../../../src/components/marketing/ExtensionSpecimens';
import { KnownPages } from '../../../../src/knownPages';
import { extensionRelease, firefoxExtensionRelease } from '../../../../src/lib/extension/release';
import { guides } from '../../../../src/lib/guides';
import { publicPageMetadata } from '../../../../src/lib/metadata';

// The published extension as docs/browser-extension.md and its receipts record it, in the words of
// the app's setup tab (BrowserExtensionGuide) and docs/browser-extension-listing.md: signed-in members
// and invited reviewers, exact project origins, and each browser's release status. Recheck every line when a
// release changes the extension; promise nothing it does not do.

export const metadata = publicPageMetadata(extensionPage.path, extensionPage);

const { labels, minimumBrowserVersion } = extensionRelease;

/** What the manifest supports: desktop Chromium from `minimum_chrome_version`; Edge installs from the Chrome Web Store */
const browsers = ['Chrome', 'Microsoft Edge'];

export default function BrowserExtensionPage() {
    return (
        <main className="flex flex-col pb-16">
            <PageHeader
                title={extensionPage.title}
                lead="Review your project’s sites without adding the script or changing the site’s security headers.">
                <div className="flex flex-wrap items-center gap-2.5">
                    <ExtensionStoreButton />
                    <Button variant="outlined" size="lg" href={guides.browserExtension.path}>Read the setup guide</Button>
                </div>
                <FirefoxExtensionNotice />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
                    <span id="supported-browsers">Supported browsers, on desktop:</span>
                    <ul aria-labelledby="supported-browsers" className="flex flex-wrap gap-2">
                        {browsers.map(name => <li key={name}><Chip>{name} {minimumBrowserVersion} or later</Chip></li>)}
                    </ul>
                </div>
            </PageHeader>

            <ExtensionSpecimens />

            <PageSection id="how-it-works" title="How it works" lead="The same review toolbar as the script, started from your browser.">
                <ol className="flex list-decimal flex-col gap-4 pl-5 text-base leading-relaxed">
                    <li className="pl-2">Add the extension, choose <strong className="font-semibold">{labels.signIn}</strong> and confirm it in {brand.name}.</li>
                    <li className="pl-2">Open a site address from your project, staging and localhost included. Sign in to the site as usual.</li>
                    <li className="pl-2">Open the extension, choose the project and <strong className="font-semibold">{labels.start}</strong>.</li>
                    <li className="pl-2">Comment, reply and resolve with the project&rsquo;s access rules. The review stays on across this site&rsquo;s pages in that tab until <strong className="font-semibold">{labels.exit}</strong>. Another domain, subdomain or port needs a new start.</li>
                </ol>
            </PageSection>

            <PageSection id="script-or-extension" title="Script or extension" lead="Both open the same toolbar and save to the same project.">
                <Panel className="md:grid-cols-2">
                    <Tile title="Install the script">
                        <p>One script tag on the site. Anyone the project allows can comment, guests with a review link included, on desktop and mobile.</p>
                    </Tile>
                    <Tile title="Use the browser extension">
                        <p>Nothing changes on the site. Signed-in members and invited reviewers comment with the extension in their own browser. Made for sites you cannot change, strict security headers, sign-in protected pages, staging and local builds.</p>
                    </Tile>
                </Panel>
            </PageSection>

            <PageSection id="requirements" title="Where it works" lead="Only where the project already allows a review.">
                <CheckList items={[
                    `Chrome or Microsoft Edge ${minimumBrowserVersion} or later, on a desktop computer. Edge installs it from the Chrome Web Store.`,
                    `The Firefox build requires desktop Firefox ${firefoxExtensionRelease.minimumBrowserVersion} or later.`,
                    'A site whose exact address, scheme and port included, is one of the project’s site addresses.',
                    'A signed-in project member or invited reviewer, with comments on for the project.',
                    'Strict Content-Security-Policy and blocked third-party cookies are fine.'
                ]} />
                <p className="text-sm leading-relaxed text-muted-foreground">Not supported: Safari and mobile browsers; browser pages, extension stores and local files; frames from other sites; and anonymous guests, who use the script.</p>
            </PageSection>

            <PageSection id="privacy" title="Permissions and privacy" lead="Only what a review on the current tab needs.">
                <Panel className="md:grid-cols-2">
                    <Tile title="Permissions">
                        <p>Temporary access to the tab where you open it, to run the toolbar and capture what is visible. On its own it reaches only {brand.domain}. It cannot read your cookies or history, or change a site&rsquo;s headers.</p>
                    </Tile>
                    <Tile title="What it sends">
                        <p>The site&rsquo;s address, to find projects you can access. What you post follows the project&rsquo;s access and retention rules, as with the script.</p>
                    </Tile>
                    <Tile title="Sign-in">
                        <p>Its own sign-in, confirmed in {brand.name}. It stays signed in across browser restarts and ends after 30 days without use, a year after you signed in, or on {labels.signOut}.</p>
                    </Tile>
                    <Tile title="On the reviewed site">
                        <p>The toolbar runs apart from the site&rsquo;s scripts. Your sign-in never reaches the page, and signing out clears unsent drafts.</p>
                    </Tile>
                </Panel>
                <p className="text-sm leading-relaxed text-muted-foreground">Read the <InlineLink href={KnownPages.LegalPrivacyPolicy}>privacy policy</InlineLink> and how {brand.name} handles <InlineLink href={KnownPages.Security}>security</InlineLink>.</p>
            </PageSection>

            <PageSection id="help" title="Help and pricing" lead={brand.pricing}>
                <p className="text-base leading-relaxed">The <InlineLink href={guides.browserExtension.path}>setup guide</InlineLink> covers installation, comment links, screenshots and common problems. Anything else: email <InlineLink href={`mailto:${brand.contact.email}`}>{brand.contact.email}</InlineLink> with the site address and what the extension showed.</p>
            </PageSection>
        </main>
    );
}
