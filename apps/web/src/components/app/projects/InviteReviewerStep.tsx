import Link from 'next/link';
import { buttonVariants } from '@/src/components/ui/button';
import { KnownPageLinks } from '@/src/knownPages';
import type { ProjectAccess } from '@/src/lib/app/model';
import { Section } from '../PageHeader';
import { InviteButton } from '../users/InviteDialog';
import { GuestReviewLinks } from './GuestReviewLinks';
import { projectAccessLabels } from './projectLabels';

/** The first reviewer step, shown below the install guide only during onboarding. */
export function InviteReviewerStep({ projectId, publicId, access, urls, isAdmin }: {
    projectId: string;
    publicId: string;
    access: ProjectAccess;
    urls: string[];
    isAdmin: boolean;
}) {
    return (
        <Section
            id="invite-reviewer"
            title="Invite a reviewer"
            description={access === 'disabled'
                ? `Comments are off. ${projectAccessLabels.disabled.description}`
                : projectAccessLabels[access].description}>
            {access === 'invited' && isAdmin && <InviteButton projectId={projectId} />}
            {access === 'guests' && <GuestReviewLinks publicId={publicId} urls={urls} />}
            {access === 'disabled' && isAdmin && (
                <Link href={KnownPageLinks.projectSettings(projectId, 'review')} className={buttonVariants({ variant: 'outline' })}>Settings</Link>
            )}
        </Section>
    );
}
