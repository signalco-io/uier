import { buttonVariants } from '@/src/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/src/components/ui/alert';
import { extensionDistribution } from '@/src/lib/extension/distribution';

export function BrowserExtensionGuide() {
    const { storeUrl } = extensionDistribution();
    return <section aria-label="Browser extension setup" className="flex flex-col gap-4">
        <h2 className="m-0 text-base font-semibold">Review without adding a script</h2>
        <p className="m-0 text-sm text-muted-foreground">The desktop extension is for signed-in project members, including invited reviewers. Each reviewer needs it in their own Chrome or Edge browser.</p>
        {storeUrl ? <a href={storeUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline', className: 'self-start' })}>Get the browser extension</a>
            : <Alert><AlertTitle>The extension is not available yet</AlertTitle><AlertDescription>Hosted browser verification and store publication are still being completed. Use the script to review your site today.</AlertDescription></Alert>}
        <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-sm">
            <li>Sign in to uier from the extension. Ask a project admin to invite you if needed.</li>
            <li>Open one of this project’s configured site addresses, including staging or localhost. Sign in to the site as you normally would.</li>
            <li>Open the extension, choose this project when several match, then choose Start review.</li>
            <li>Review continues on reload and same-origin navigation in that tab. Exit review stops it. Changing origin requires Start review again.</li>
        </ol>
        <p className="m-0 text-sm text-muted-foreground">Existing comment links open their thread after activation. Recipients also need the extension on a site without the script. Anonymous guest reviews use the script.</p>
        <p className="m-0 text-sm text-muted-foreground">No source or security-header changes are needed for the extension. Browser pages, extension stores, local files and cross-origin iframe contents are unsupported. Screenshots capture only the visible viewport.</p>
    </section>;
}
