import { buttonVariants } from '@/src/components/ui/button';
import { extensionDistribution } from '@/src/lib/extension/distribution';
import { extensionRelease, firefoxExtensionRelease } from '@/src/lib/extension/release';
import { guides } from '@/src/lib/guides';

const guideLinkClassName = 'self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground';

/**
 * The install guide's browser extension tab. Until the extension is in the store it is one line and the
 * setup guide; the steps come back once `extensionDistribution()` says it is available.
 */
export function BrowserExtensionGuide() {
    const { storeUrl } = extensionDistribution();
    if (!storeUrl) {
        return <section aria-label="Browser extension setup" className="flex flex-col gap-2">
            <p className="m-0 text-sm text-muted-foreground">The browser extension is not available yet. Use the script to review your site.</p>
            <p className="m-0 text-sm text-muted-foreground">{firefoxExtensionRelease.availabilityMessage}</p>
            <a href={guides.browserExtension.path} target="_blank" rel="noopener noreferrer" className={guideLinkClassName}>Read the extension setup guide</a>
        </section>;
    }
    return <section aria-label="Browser extension setup" className="flex flex-col gap-4">
        <h2 className="m-0 text-base font-semibold">Review without adding a script</h2>
        <p className="m-0 text-sm text-muted-foreground">The desktop extension is for signed-in project members, including invited reviewers. Each reviewer needs it in their own Chrome or Edge browser.</p>
        <a href={storeUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline', className: 'self-start' })}>{extensionRelease.storeLabel}</a>
        <p className="m-0 text-sm text-muted-foreground">{firefoxExtensionRelease.availabilityMessage}</p>
        <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-sm">
            <li>Sign in to uier from the extension. Ask a project admin to invite you if needed.</li>
            <li>Open one of this project’s configured site addresses, including staging or localhost. Sign in to the site as you normally would.</li>
            <li>Open the extension, choose this project when several match, then choose Start review.</li>
            <li>Review continues on reload and same-origin navigation in that tab. Exit review stops it. Changing origin requires Start review again.</li>
        </ol>
        <p className="m-0 text-sm text-muted-foreground">Existing comment links open their thread after activation. Recipients also need the extension on a site without the script. Anonymous guest reviews use the script.</p>
        <p className="m-0 text-sm text-muted-foreground">No source or security-header changes are needed for the extension. Browser pages, extension stores, local files and cross-origin iframe contents are unsupported. Screenshots capture only the visible viewport.</p>
        <a href={guides.browserExtension.path} target="_blank" rel="noopener noreferrer" className={guideLinkClassName}>Read the extension setup guide</a>
    </section>;
}

/** The onboarding's one line about the extension, once it is available: the way to review a site without the script */
export function BrowserExtensionNote() {
    if (!extensionDistribution().available)
        return null;
    return (
        <p className="m-0 text-sm text-muted-foreground">
            Can’t change the site’s code? Members can review it with the{' '}
            <a href={guides.browserExtension.path} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">browser extension</a> instead.
        </p>
    );
}
