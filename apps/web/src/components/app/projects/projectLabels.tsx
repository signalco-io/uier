import { GlobeIcon, LockIcon, MessageSquareOffIcon, type LucideProps } from 'lucide-react';
import type { ProjectAccess } from '../../../lib/app/model';

/** Who can comment, as the app shows it */
export const projectAccessLabels: Record<ProjectAccess, { label: string; description: string }> = {
    invited: {
        label: 'Invited people',
        description: 'Only people you invite can see and leave comments. They sign in with their email.'
    },
    guests: {
        label: 'Anyone with the link',
        description: 'Anyone who opens a review link can see and leave comments. Guests are asked for their name.'
    },
    disabled: {
        label: 'Comments off',
        description: 'Nobody can leave comments on the site. Existing comments stay here.'
    }
};

const accessIcons = { invited: LockIcon, guests: GlobeIcon, disabled: MessageSquareOffIcon } as const;

/** The icon of a project's comment access (a lock, the globe, comments off) */
export function AccessIcon({ access, ...props }: LucideProps & { access: ProjectAccess }) {
    const Icon = accessIcons[access];
    return <Icon {...props} />;
}

/** `https://www.example.com/app` -> `www.example.com/app` */
export function displayUrl(url: string) {
    return url.replace(/^https?:\/\//, '');
}
