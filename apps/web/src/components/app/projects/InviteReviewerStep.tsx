
import { getAppI18n } from '@/src/lib/i18n/server';
import Link from 'next/link';
import { buttonVariants } from '@/src/components/ui/button';
import { KnownPageLinks } from '@/src/knownPages';
import type { ProjectAccess } from '@/src/lib/app/model';
import { extensionDistribution } from '@/src/lib/extension/distribution';
import { guides } from '@/src/lib/guides';
import { InviteButton } from '../users/InviteDialog';
import { GuestReviewLinks } from './GuestReviewLinks';
import { OnboardingStepCard } from './OnboardingStepCard';
import { projectAccessLabels } from './projectLabels';

/**
 * Onboarding's last step: who can comment, and how to bring in the first reviewer (Invite for admins of an
 * invited-only project, the guest links of an open one). Finish opens the project's comments.
 */
export async function InviteReviewerStep({ projectId, publicId, access, urls, isAdmin, back }: {
    projectId: string;
    publicId: string;
    access: ProjectAccess;
    urls: string[];
    isAdmin: boolean;
    back: string;
}) {
    const { t } = await getAppI18n();
    const invites = access === 'invited' && isAdmin;
    return (
        <OnboardingStepCard
            id="invite-reviewer"
            title={t("Invite a reviewer")}
            description={access === 'disabled'
                ? t("Comments are off. {value0}", { value0: projectAccessLabels.disabled.description })
                : projectAccessLabels[access].description}
            back={back}
            // Inviting is the step's primary action; Finish is for once it is done
            next={{ href: KnownPageLinks.project(projectId), label: 'Finish', primary: !invites }}>
            {access === 'invited' && <InvitedReviewerPath />}
            {invites && <InviteButton projectId={projectId} className="self-start" />}
            {access === 'guests' && <GuestReviewLinks publicId={publicId} urls={urls} />}
            {access === 'disabled' && isAdmin && (
                <Link href={KnownPageLinks.projectSettings(projectId, 'review')} className={buttonVariants({ variant: 'outline', className: 'self-start' })}>{t("Settings")}</Link>
            )}
        </OnboardingStepCard>
    );
}

/** How an invited reviewer reaches the site, and what that needs */
async function InvitedReviewerPath() {
    const { t } = await getAppI18n();
    return (
        <p className="m-0 text-sm text-muted-foreground">
            {extensionDistribution().available ? (<>{t("Accepting the invitation opens your site with the toolbar. On a site without the script, each reviewer needs the")}{' '}<a href={guides.browserExtension.path} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">{t("browser extension")}</a>.
            </>) : t("Once the script is on your site, accepting the invitation opens it with the toolbar.")}
        </p>
    );
}
