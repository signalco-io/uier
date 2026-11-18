import { getAppI18n } from '@/src/lib/i18n/server';
import { buttonVariants } from '@/src/components/ui/button';
import { extensionDistribution } from '@/src/lib/extension/distribution';
import { extensionRelease, firefoxExtensionRelease } from '@/src/lib/extension/release';
import { guides } from '@/src/lib/guides';

const guideLinkClassName = 'self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground';

export async function BrowserExtensionGuide() {
    const { t } = await getAppI18n();
    const { storeUrl } = extensionDistribution();
    return <section aria-label={t("Browser extension setup")} className="flex flex-col gap-4">
        <h2 className="m-0 text-base font-semibold">{t("Review without adding a script")}</h2>
        <p className="m-0 text-sm text-muted-foreground">{t("The desktop extension is for signed-in project members, including invited reviewers.")}</p>
        <div className="flex flex-wrap gap-2">
            {storeUrl && <a href={storeUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline' })}>{extensionRelease.storeLabel}</a>}
            <a href={firefoxExtensionRelease.storeUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline' })}>{firefoxExtensionRelease.storeLabel}</a>
        </div>
        <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-sm">
            <li>{t("Sign in to uier from the extension. Ask a project admin to invite you if needed.")}</li>
            <li>{t("Open one of this project’s configured site addresses, including staging or localhost. Sign in to the site as you normally would.")}</li>
            <li>{t("Open the extension, choose this project when several match, then choose Start review.")}</li>
            <li>{t("Review continues on reload and same-origin navigation in that tab. Exit review stops it. Changing origin requires Start review again.")}</li>
        </ol>
        <p className="m-0 text-sm text-muted-foreground">{t("Existing comment links open their thread after activation. Recipients also need the extension on a site without the script. Anonymous guest reviews use the script.")}</p>
        <p className="m-0 text-sm text-muted-foreground">{t("No source or security-header changes are needed for the extension. Browser pages, extension stores, local files and cross-origin iframe contents are unsupported. Screenshots capture only the visible viewport.")}</p>
        <a href={guides.browserExtension.path} target="_blank" rel="noopener noreferrer" className={guideLinkClassName}>{t("Read the extension setup guide")}</a>
    </section>;
}

/** The onboarding's one line about reviewing a site without the script. */
export async function BrowserExtensionNote() {
    const { t } = await getAppI18n();
    return (
        <p className="m-0 text-sm text-muted-foreground">{t("Can’t change the site’s code? Members can review it with the")}{' '}
            <a href={guides.browserExtension.path} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">{t("browser extension")}</a>{' '}{t("instead.")}{' '}</p>
    );
}
