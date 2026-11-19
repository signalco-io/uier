'use client';

import type { ReactNode } from 'react';
import { KeyRoundIcon } from 'lucide-react';
import { useAppI18n } from '@/src/lib/i18n/client';
import { Bar, ListOutline, Loading, SectionOutline } from '../loading/outlines';
import { ProjectMark } from '../projects/ProjectMark';
import { useShellInfo } from '../shell/ShellInfo';
import { GoogleLogo, MicrosoftLogo } from '../SignInProviderLogos';
import { accountTitles as titles } from './accountSections';

// The account's sections while they load (docs/design/loading-states, 14 and 15): `AccountFrame` keeps the heading
// and the section links real, and each section draws its cards with their real titles (fixed text, `accountTitles`)
// over outlines of what the account decides. One status per section. A card or row only some accounts have is not
// drawn, unless the shell beside it already shows it (`useShellInfo`: the workspace's projects).

/** The settings column's own layout (`SettingsLayout`): its cards one under another */
const stack = 'flex flex-col gap-6';

/** A card's title after its mark, as `Section`'s `icon` lays them out */
function IconTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
    return (
        <span className="flex items-center gap-2">
            <span aria-hidden="true" className="flex shrink-0 [&_svg:not([class*='size-'])]:size-4">{icon}</span>
            {children}
        </span>
    );
}

/** General: the profile (picture beside the name), the two languages, the theme and the person's access */
export function AccountGeneralLoading() {
    const { t } = useAppI18n();
    return (
        <Loading label="Loading account" className={stack}>
            <SectionOutline title={t(titles.profile)} description={false}>
                <div className="flex flex-wrap items-start gap-x-4 gap-y-3 sm:gap-x-6">
                    <Bar className="size-16 shrink-0 rounded-full" />
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <Bar className="h-4 w-28" />
                        <Bar className="h-9 w-full max-w-md rounded-lg" />
                    </div>
                </div>
            </SectionOutline>
            <SectionOutline title={t(titles.appLanguage)} description={false} fields={1} />
            <SectionOutline title={t(titles.appearance)} footer={false}>
                <Bar className="h-9 w-64 max-w-full rounded-lg" />
            </SectionOutline>
            <SectionOutline title={t(titles.toolbarLanguage)} description={false} fields={1} />
            <SectionOutline title={t(titles.access)} footer={false}>
                {/* Role and projects, which every member has; relationship and teams arrive with the page */}
                <div className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2">
                    {['w-10', 'w-16'].map(label => (
                        <div key={label} className="contents">
                            <span className="flex h-5 items-center"><Bar className={`h-3.5 ${label}`} /></span>
                            <span className="flex h-5 items-center"><Bar className="h-3.5 w-40 max-w-full" /></span>
                        </div>
                    ))}
                </div>
            </SectionOutline>
        </Loading>
    );
}

/** A sign-in method that is not linked yet: a line and its button */
function SignInMethodOutline() {
    return (
        <div className="flex flex-col items-start gap-3">
            <span className="flex h-5 items-center"><Bar className="h-3.5 w-48" /></span>
            <Bar className="h-9 w-44 rounded-lg" />
        </div>
    );
}

/**
 * Sign-in: the methods, each a card with its mark before the title. Sign out is under them for real
 * (`SignOutSection`, outside the page's boundary). Google and Microsoft are drawn where this deployment offers them,
 * which the shell knows (`useShellInfo().signIn`), so a card never shows and goes.
 */
export function AccountSignInLoading() {
    const { t } = useAppI18n();
    const offered = useShellInfo()?.signIn;
    return (
        <Loading label="Loading sign-in" className={stack}>
            {offered?.google && <SectionOutline title={<IconTitle icon={<GoogleLogo />}>{t(titles.google)}</IconTitle>} footer={false}><SignInMethodOutline /></SectionOutline>}
            {offered?.microsoft && <SectionOutline title={<IconTitle icon={<MicrosoftLogo />}>{t(titles.microsoft)}</IconTitle>} footer={false}><SignInMethodOutline /></SectionOutline>}
            <SectionOutline title={<IconTitle icon={<KeyRoundIcon />}>{t(titles.passkeys)}</IconTitle>} footer={false}>
                <span className="flex h-5 items-center"><Bar className="h-3.5 w-32" /></span>
            </SectionOutline>
        </Loading>
    );
}

/**
 * Notifications: the workspace's projects, each with its switch. The projects are the ones the sidebar lists, so
 * their marks and names are there at once and only the switches wait; without them, three rows' outlines.
 */
export function AccountNotificationsLoading() {
    const { t } = useAppI18n();
    const info = useShellInfo();
    const rows: ({ id: string; name: string; url?: string } | undefined)[] = info
        ? Object.entries(info.projects).map(([id, { name, url }]) => ({ id, name, url }))
        : [undefined, undefined, undefined];
    return (
        <Loading label="Loading notifications" className={stack}>
            <SectionOutline title={t(titles.projectEmails)} footer={false}>
                {rows.length === 0
                    // "No projects here yet."
                    ? <span className="flex h-5 items-center"><Bar className="h-3.5 w-40" /></span>
                    : (
                        <div className="flex flex-col divide-y">
                            {rows.map((project, row) => (
                                <div key={project?.id ?? row} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                                    {project
                                        ? <><ProjectMark name={project.name} projectId={project.id} url={project.url} /><span className="min-w-0 flex-1 truncate text-sm font-medium">{project.name}</span></>
                                        : <><Bar className="size-4 shrink-0 rounded-[4px]" /><span className="flex h-5 min-w-0 flex-1 items-center"><Bar className="h-4 w-40 max-w-full" /></span></>}
                                    <Bar className="h-5 w-9 shrink-0 rounded-full" />
                                </div>
                            ))}
                        </div>
                    )}
            </SectionOutline>
        </Loading>
    );
}

/** A limit: its name and count over its bar */
function MeterOutline() {
    return (
        <div className="flex min-w-0 flex-col gap-2">
            <div className="flex h-5 items-center justify-between gap-3">
                <Bar className="h-3.5 w-28" />
                <Bar className="h-3.5 w-14" />
            </div>
            <Bar className="h-1.5 w-full rounded-full" />
        </div>
    );
}

/**
 * Usage: the person's limits in each project, three meters under the project's name. The page lists the projects of
 * every workspace the person is in, so these are outlines, two of them; "Your network" only shows once a limit of
 * the connection is in use and arrives with the page.
 */
export function AccountUsageLoading() {
    const { t } = useAppI18n();
    return (
        <Loading label="Loading usage" className={stack}>
            <SectionOutline title={t(titles.limits)} footer={false}>
                <div className="flex flex-col divide-y">
                    {[0, 1].map(project => (
                        <div key={project} className="flex flex-col gap-4 py-5 first:pt-0 last:pb-0">
                            <div className="flex h-5 items-center gap-3">
                                <Bar className="size-4 shrink-0 rounded-[4px]" />
                                <Bar className="h-4 w-36" />
                            </div>
                            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                                <MeterOutline />
                                <MeterOutline />
                                <MeterOutline />
                            </div>
                        </div>
                    ))}
                </div>
            </SectionOutline>
        </Loading>
    );
}

export function AccountApiTokensLoading() {
    const { t } = useAppI18n();
    return <Loading label="Loading account" className={stack}>
        <SectionOutline title={t('API tokens')} fields={2} />
    </Loading>;
}

/** Coding agents: its five cards, the connected apps and the access tokens as lists */
export function AccountCodingAgentsLoading() {
    const { t } = useAppI18n();
    return (
        <Loading label="Loading coding agents" className={stack}>
            <SectionOutline title={t(titles.connectedApps)} footer={false}><ListOutline rows={1} className="rounded-lg" /></SectionOutline>
            <SectionOutline title={t(titles.plugin)} fields={1} footer={false} />
            <SectionOutline title={t(titles.connect)} fields={2} footer={false} />
            <SectionOutline title={t(titles.accessTokens)} footer={false}><ListOutline rows={1} avatar={false} className="rounded-lg" /></SectionOutline>
            <SectionOutline title={t(titles.skill)} footer={false}><ListOutline rows={3} avatar={false} trailing={false} className="rounded-lg" /></SectionOutline>
        </Loading>
    );
}
