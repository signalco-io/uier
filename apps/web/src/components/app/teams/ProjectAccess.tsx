
import { getAppI18n } from '@/src/lib/i18n/server';
import Link from 'next/link';
import { CheckIcon, FolderIcon, FoldersIcon, ShieldIcon, UserIcon, UsersIcon, type LucideIcon } from 'lucide-react';
import type { AppContext } from '@/src/lib/app/context';
import type { DbProject } from '@/src/lib/app/model';
import { projectAccessGrants, type ProjectAccessGrant } from '@/src/lib/app/access';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { Badge } from '@/src/components/ui/badge';
import { cn } from 'cn';
import { buttonVariants } from '@/src/components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { Section } from '../PageHeader';
import { PersonAvatar } from '../PersonAvatar';
import { ProjectMark } from '../projects/ProjectMark';
import { managementData } from './management';
import { ProjectTeamButton, RemoveProjectAccess } from './ProjectAccessButtons';
import { InviteButton } from '../users/InviteDialog';

// The tile stays centred on the row (Item tops it when there is a description), as on the users list
const centeredMedia = 'group-has-data-[slot=item-description]/item:translate-y-0 group-has-data-[slot=item-description]/item:self-center';
const tile = 'size-8 rounded-lg text-sm [&>img]:p-1.5';

function ListHeading({ id, icon: Icon, title, count }: { id: string; icon: LucideIcon; title: string; count: number }) {
    return (
        <h3 id={id} className="m-0 flex items-center gap-2 text-sm font-medium">
            <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
            {title}
            <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
        </h3>
    );
}

function EmptyRow({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
    return (
        <p className="m-0 flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            <Icon aria-hidden="true" className="size-4" />
            {children}
        </p>
    );
}

/**
 * Why someone can review the project, by where the grant lives: the workspace (admin, every project),
 * this project or a team. Icons, not tiles: a letter inside a chip reads as part of its label.
 */
async function GrantBadge({ grant, project, workspace }: { grant: ProjectAccessGrant; project: DbProject; workspace: string }) {
    const { t } = await getAppI18n();
    switch (grant.kind) {
        case 'admin':
            return (
                <Badge variant="outline" title={t("Admin of {value0}", { value0: workspace })}>
                    <ShieldIcon data-icon="inline-start" aria-hidden="true" />{t("Admin")}</Badge>
            );
        case 'all':
            return (
                <Badge variant="outline" title={t("Every project, including future ones")}>
                    <FoldersIcon data-icon="inline-start" aria-hidden="true" />{t("All projects")}</Badge>
            );
        case 'direct':
            return (
                <Badge variant="outline" title={t("Added to {value0}", { value0: project.name })}>
                    <FolderIcon data-icon="inline-start" aria-hidden="true" />{t("Direct")}</Badge>
            );
        case 'team':
            return (
                <Badge variant="outline" render={<Link href={KnownPageLinks.team(grant.team.id)} title={t("Through the team {value0}", { value0: grant.team.name })} />}>
                    <UsersIcon data-icon="inline-start" aria-hidden="true" />
                    {grant.team.name}
                </Badge>
            );
    }
}

export async function ProjectPeopleAndTeams({ context, project }: { context: AppContext; project: DbProject }) {
    const { t } = await getAppI18n();
    const data = await managementData(context);
    const people = data.people.flatMap((person) => {
        const grants = projectAccessGrants(data.access, person.member, project);
        return grants.length ? [{ person, grants }] : [];
    });
    return (
        <Section
            id="people-and-teams"
            title={t("People and teams")}
            actions={(
                // Invite starts with this project chosen. Teams and people are managed for the whole workspace
                // in its area; icons only on phones, so the title keeps its line
                <div className="flex gap-2">
                    <Link href={KnownPages.AppTeams} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'max-sm:px-2!')}><UsersIcon data-icon="inline-start" aria-hidden="true" /><span className="max-sm:sr-only">{t("Manage teams")}</span></Link>
                    <Link href={KnownPages.AppUsers} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'max-sm:px-2!')}><UserIcon data-icon="inline-start" aria-hidden="true" /><span className="max-sm:sr-only">{t("Manage users")}</span></Link>
                    <InviteButton projectId={project.id} size="sm" />
                </div>
            )}
        >
            <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-3">
                    <ListHeading id="project-teams-title" icon={UsersIcon} title={t("Teams")} count={data.access.teams.length} />
                    {data.access.teams.length ? (
                        <ItemGroup aria-labelledby="project-teams-title" className="gap-0 divide-y rounded-lg border has-data-[size=sm]:gap-0">
                            {data.access.teams.map((team) => {
                                const members = data.people.filter((person) => person.member.teamIds?.includes(team.id));
                                const external = members.filter((person) => person.member.relationship === 'external').length;
                                const shared = team.projectIds.includes(project.id);
                                return (
                                    <Item key={team.id} role="listitem" size="sm" className="rounded-none">
                                        <ItemMedia className={centeredMedia}>
                                            <ProjectMark name={team.name} className={tile} />
                                        </ItemMedia>
                                        <ItemContent className="min-w-0">
                                            <ItemTitle>
                                                <Link href={KnownPageLinks.team(team.id)} className="underline-offset-4 hover:underline">{team.name}</Link>
                                            </ItemTitle>
                                            <ItemDescription className="flex items-center gap-1.5 tabular-nums">
                                                <UserIcon aria-hidden="true" className="size-3.5 shrink-0" />
                                                {members.length} {members.length === 1 ? 'person' : 'people'}
                                                {external > 0 && t(" · {value0} external", { value0: external })}
                                            </ItemDescription>
                                        </ItemContent>
                                        <ItemActions className="ml-auto">
                                            {shared && (
                                                <Badge variant="secondary">
                                                    <CheckIcon data-icon="inline-start" aria-hidden="true" />{t("Shared")}</Badge>
                                            )}
                                            <ProjectTeamButton team={team} project={project} data={data} />
                                        </ItemActions>
                                    </Item>
                                );
                            })}
                        </ItemGroup>
                    ) : (
                        <EmptyRow icon={UsersIcon}>{t("No teams yet")}</EmptyRow>
                    )}
                </div>
                <div className="flex flex-col gap-3">
                    <ListHeading id="project-people-title" icon={UserIcon} title={t("People with access")} count={people.length} />
                    {people.length ? (
                        <ItemGroup aria-labelledby="project-people-title" className="gap-0 divide-y rounded-lg border has-data-[size=sm]:gap-0">
                            {people.map(({ person, grants }) => (
                                <Item key={person.member.id} role="listitem" size="sm" className="rounded-none">
                                    <ItemMedia className={centeredMedia}>
                                        <PersonAvatar name={person.name} avatarUrl={person.avatarUrl} aria-hidden="true" />
                                    </ItemMedia>
                                    <ItemContent className="min-w-40">
                                        <ItemTitle>
                                            <Link href={KnownPageLinks.member(person.member.userId)} className="underline-offset-4 hover:underline">{person.name}</Link>
                                            {person.member.userId === context.user.id && <span className="font-normal text-muted-foreground">{t("(you)")}</span>}
                                        </ItemTitle>
                                        {/* Two people can share a name: the address tells them apart */}
                                        <ItemDescription className="truncate font-mono text-[13px]">{person.member.email}</ItemDescription>
                                    </ItemContent>
                                    {/* Every source of access, so removing one shows what still grants it */}
                                    <ItemContent className="min-w-0 basis-48">
                                        <div className="flex flex-wrap gap-1">
                                            {grants.map((grant) => (
                                                <GrantBadge
                                                    key={grant.kind === 'team' ? grant.team.id : grant.kind}
                                                    grant={grant}
                                                    project={project}
                                                    workspace={context.workspace.name}
                                                />
                                            ))}
                                        </div>
                                    </ItemContent>
                                    <ItemActions className="ml-auto">
                                        <RemoveProjectAccess person={person} project={project} data={data} />
                                    </ItemActions>
                                </Item>
                            ))}
                        </ItemGroup>
                    ) : (
                        <EmptyRow icon={UserIcon}>{t("No one has member access yet")}</EmptyRow>
                    )}
                </div>
            </div>
        </Section>
    );
}
