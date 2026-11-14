'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRightIcon, SettingsIcon } from 'lucide-react';
import { PopoverDescription, PopoverHeader, PopoverTitle } from '@/src/components/ui/popover';
import { AvatarGroup, AvatarGroupCount } from '@/src/components/ui/avatar';
import { Skeleton } from '@/src/components/ui/skeleton';
import type { ProjectAccess } from '../../../lib/app/model';
import { LinkPopover } from '../LinkPopover';
import { PersonAvatar } from '../PersonAvatar';
import { pluralText } from '../teams/pluralText';
import { projectPeoplePreviewAction, type ProjectPeoplePreview } from './headerActions';
import { AccessIcon, projectAccessLabels } from './projectLabels';

type PeopleState = { status: 'loading' } | { status: 'error' } | { status: 'loaded'; preview: ProjectPeoplePreview | null };

// One row height for the placeholder, the people and an error, so the popover keeps its size when they load
const peopleRow = 'flex h-10 items-center gap-3 text-sm';
const avatarRing = '*:data-[slot=avatar]:ring-popover *:data-[slot=avatar-group-count]:ring-popover';

/** A few of the people with access as avatars, then how many there are (uier #420); a link to them for admins */
function PeopleRow({ state, href }: { state: PeopleState; href?: string }) {
    const { t, language } = useAppI18n();
    if (state.status === 'loading') {
        return (
            <div className={peopleRow} role="status" aria-label={t("Loading people")}>
                <div className="flex -space-x-2">
                    {[0, 1, 2].map(index => <Skeleton key={index} className="size-8 rounded-full ring-2 ring-popover" />)}
                </div>
                <Skeleton className="h-4 w-20" />
            </div>
        );
    }
    if (state.status === 'error')
        return <p className={`${peopleRow} m-0 text-muted-foreground`}>{t("Could not load people.")}</p>;
    const { preview } = state;
    if (!preview)
        return null;
    const others = preview.count - preview.people.length;
    const content = (
        <>
            <AvatarGroup aria-hidden="true" className={avatarRing}>
                {preview.people.map(person => <PersonAvatar key={person.id} name={person.name} avatarUrl={person.avatarUrl} title={person.name} />)}
                {others > 0 && <AvatarGroupCount className="text-xs tabular-nums">+{others}</AvatarGroupCount>}
            </AvatarGroup>
            <span className="min-w-0 flex-1 tabular-nums">
                {preview.count ? pluralText(t, language, preview.count, '{count} person', '{count} people') : t("No one has member access yet")}
            </span>
        </>
    );
    return href ? (
        <Link
            href={href}
            className={`${peopleRow} -mx-2 rounded-md px-2 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring`}>
            {content}
            <ChevronRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        </Link>
    ) : (
        <div className={peopleRow}>{content}</div>
    );
}

/**
 * The project's comment access in the header; hover or focus it for more info: who has access when only
 * invited people do (loaded when it opens), the guest links for guests, and for admins Invite.
 * With `href` (those who configure the project) it is a link: to People and teams when only invited
 * people comment, else to Who can comment (`accessHref`, also in the popover); without, a click opens the info.
 */
export function ProjectAccessInfo({ access, projectId, href, accessHref, peopleHref, people = false, children }: {
    access: ProjectAccess;
    projectId: string;
    href?: string;
    /** Who can comment in the project's settings, for those who change it */
    accessHref?: string;
    /** People and teams in the project's settings, for those who manage them */
    peopleHref?: string;
    /** Show who has access (when only invited people can comment) */
    people?: boolean;
    children?: ReactNode;
}) {
    const { t } = useAppI18n();
    const { label, description } = projectAccessLabels[access];
    const [state, setState] = useState<PeopleState>({ status: 'loading' });

    function loadPeople() {
        if (!people)
            return;
        // Shown again while it refreshes (someone was invited since), the placeholder only the first time
        setState(current => current.status === 'loaded' ? current : { status: 'loading' });
        projectPeoplePreviewAction(projectId).then(
            preview => setState({ status: 'loaded', preview }),
            () => setState(current => current.status === 'loaded' ? current : { status: 'error' }));
    }

    return (
        <LinkPopover
            href={href}
            label={t(label)}
            onOpen={loadPeople}
            trigger={(
                <>
                    <AccessIcon access={access} className="size-4" aria-hidden="true" />
                    {t(label)}
                </>
            )}>
            <PopoverHeader>
                <PopoverTitle>{t(label)}</PopoverTitle>
                <PopoverDescription>{t(description)}</PopoverDescription>
            </PopoverHeader>
            {people && <PeopleRow state={state} href={peopleHref} />}
            {children}
            {accessHref && (
                <Link href={accessHref} className="flex items-center gap-1.5 self-start rounded-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                    <SettingsIcon aria-hidden="true" className="size-4" />
                    {t("Who can comment")}
                </Link>
            )}
        </LinkPopover>
    );
}
