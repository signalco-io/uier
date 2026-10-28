import Link from 'next/link';
import { Button } from '@/src/components/ui/button';
import { KnownPageLinks } from '@/src/knownPages';
import type { ProjectAccess } from '@/src/lib/app/model';
import { Section } from '../PageHeader';
import { InviteButton } from '../users/InviteDialog';
import { GuestReviewLinks } from './GuestReviewLinks';
import { projectAccessLabels } from './projectLabels';

/** The first reviewer step, shown below the install guide only during onboarding. */
export function InviteReviewerStep({ projectId, access, urls, isAdmin }: {
    projectId: string;
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
            {access === 'guests' && <GuestReviewLinks projectId={projectId} urls={urls} />}
            {access === 'disabled' && isAdmin && (
                <Button variant="outline" asChild>
                    <Link href={KnownPageLinks.projectSettings(projectId)}>Settings</Link>
                </Button>
            )}
        </Section>
    );
}
