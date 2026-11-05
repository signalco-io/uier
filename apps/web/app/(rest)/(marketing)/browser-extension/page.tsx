import { Button } from '@signalco/ui-primitives/Button';
import { brand } from '@uier/brand';
import { CheckList, InlineLink, PageHeader, PageSection, Panel, Tile } from '../../../../src/components/marketing/ContentPage';
import { ExtensionStoreButton, extensionPage } from '../../../../src/components/marketing/BrowserExtension';
import { KnownPages } from '../../../../src/knownPages';
import { extensionRelease } from '../../../../src/lib/extension/release';
import { guides } from '../../../../src/lib/guides';
import { publicPageMetadata } from '../../../../src/lib/metadata';

// The published extension as docs/browser-extension.md and its receipts record it, in the words of
// the app's setup tab (BrowserExtensionGuide) and docs/browser-extension-listing.md: signed-in members
// and invited reviewers, exact project origins, desktop Chrome and Edge. Recheck every line when a
// release changes the extension; promise nothing it does not do.

export const metadata = publicPageMetadata(extensionPage.path, extensionPage);

const { labels } = extensionRelease;

export default function BrowserExtensionPage() {
    return (
        <main className="flex flex-col pb-16">
            <PageHeader
                title={extensionPage.title}
                lead="Review your project’s sites in desktop Chrome or Edge, without adding the script or changing the site’s security headers.">
                <div className="flex flex-wrap items-center gap-2.5">
                    <ExtensionStoreButton />
                    <Button variant="outlined" size="lg" href={guides.browserExtension.path}>Read the setup guide</Button>
                </div>
            </PageHeader>

            <PageSection id="how-it-works" title="How it works" lead="The same review toolbar as the script, started from your browser.">
                <ol className="flex list-decimal flex-col gap-4 pl-5 text-base leading-relaxed">
                    <li className="pl-2">Add the extension to Chrome or Edge on your computer. In the extension, choose <strong className="font-semibold">{labels.signIn}</strong> and confirm it in {brand.name}.</li>
                    <li className="pl-2">Open one of your project&rsquo;s site addresses, including staging or localhost. Sign in to the site as you normally would.</li>
                    <li className="pl-2">Open the extension. It lists the projects you can access that include this exact address. Choose one when several match, then <strong className="font-semibold">{labels.start}</strong>.</li>
                    <li className="pl-2">Pin comments to elements, selected text or areas. Reply, resolve and reopen threads with the project&rsquo;s usual access rules.</li>
                    <li className="pl-2">The review continues on reloads and other pages of the same site in that tab. <strong className="font-semibold">{labels.exit}</strong> stops it; another domain, subdomain or port needs <strong className="font-semibold">{labels.start}</strong> again.</li>
                </ol>
            </PageSection>

            <PageSection id="script-or-extension" title="Script or extension" lead="Both open the same toolbar and save feedback to the same project. A project’s review setup in the app offers both.">
                <Panel className="md:grid-cols-2">
                    <Tile title="Install the script">
                        <p>One script tag on the site. Anyone the project allows can comment, including guests with a review link, on desktop and mobile.</p>
                        <p>Choose it when you can change the site and reviewers should not install anything.</p>
                    </Tile>
                    <Tile title="Use the browser extension">
                        <p>Nothing changes on the site. Signed-in project members and invited reviewers comment from desktop Chrome or Edge, and each of them needs the extension in their own browser.</p>
                        <p>Choose it for sites you cannot change, strict security headers, sign-in protected pages, staging and local builds.</p>
                    </Tile>
                </Panel>
            </PageSection>

            <PageSection id="requirements" title="Where it works" lead="The extension opens a review only where the project already allows one.">
                <CheckList items={[
                    `Chrome or Microsoft Edge ${extensionRelease.minimumBrowserVersion} or later, on a desktop computer. Edge installs it from the Chrome Web Store.`,
                    'A site whose exact address, including the scheme and port, is one of the project’s site addresses. Sign-in protected, staging and localhost sites work the same way.',
                    'A signed-in project member or invited reviewer, with comments turned on for the project.',
                    'Sites with a strict Content-Security-Policy, and browsers that block third-party cookies.'
                ]} />
                <p className="text-sm leading-relaxed text-muted-foreground">Not supported: Firefox, Safari and mobile browsers; browser pages, extension stores and local files; content inside frames from other sites; and anonymous guests, who review through the script.</p>
            </PageSection>

            <PageSection id="privacy" title="Permissions and privacy" lead="It asks only for what a review on the current tab needs.">
                <Panel className="md:grid-cols-2">
                    <Tile title="Permissions">
                        <p>Temporary access to the tab where you open it, to run the toolbar there and capture what is visible. The only site it can reach on its own is {brand.domain}. It cannot read your cookies or history, or change a site&rsquo;s headers.</p>
                    </Tile>
                    <Tile title="What it sends">
                        <p>When you open it, it sends the site&rsquo;s address to find projects you can access. What you post, with the page details and screenshots, follows the project&rsquo;s access and retention rules, as it does with the script.</p>
                    </Tile>
                    <Tile title="Sign-in">
                        <p>The extension has its own sign-in, confirmed in {brand.name}. It stays signed in across browser restarts. It ends after 30 days without use, a year after you signed in, or when you choose {labels.signOut}.</p>
                    </Tile>
                    <Tile title="On the reviewed site">
                        <p>The toolbar runs apart from the site&rsquo;s own scripts. Your sign-in never reaches the page, its storage or its scripts, and signing out clears unsent drafts.</p>
                    </Tile>
                </Panel>
                <p className="text-sm leading-relaxed text-muted-foreground">Read the <InlineLink href={KnownPages.LegalPrivacyPolicy}>privacy policy</InlineLink> and how {brand.name} handles <InlineLink href={KnownPages.Security}>security</InlineLink>.</p>
            </PageSection>

            <PageSection id="help" title="Help and pricing" lead={brand.pricing}>
                <p className="text-base leading-relaxed">The <InlineLink href={guides.browserExtension.path}>setup guide</InlineLink> covers installation, comment links, screenshots and common problems. For anything else, email <InlineLink href={`mailto:${brand.contact.email}`}>{brand.contact.email}</InlineLink> with the site address and what the extension showed.</p>
            </PageSection>
        </main>
    );
}
