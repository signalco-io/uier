
import { getAppI18n } from '@/src/lib/i18n/server';
import type { Metadata } from 'next';
import { Section } from '@/src/components/app/PageHeader';
import { requireAppContext } from '@/src/lib/app/context';
import { listVisibleProjects } from '@/src/lib/app/projects';
import { loadWorkspaceAccess } from '@/src/lib/app/access';
import { avatarUrl } from '@/src/lib/app/avatars';
import { AccountForm, AppearanceSection } from './AccountForm';
import { AppLanguageForm } from './AppLanguageForm';
import { userAppLanguage } from '@/src/lib/app/appLanguage';
import { ToolbarLanguageForm } from './ToolbarLanguageForm';
import { userToolbarLanguage } from '@/src/lib/app/toolbarLanguage';

export const metadata: Metadata = {
    title: 'Account'
};

const relationshipLabels = { internal: 'Internal', external: 'External' } as const;

/** General: the name, the theme, the toolbar's language and the person's access in the selected workspace */
export default async function AccountPage() {
    const { t, language } = await getAppI18n();
    const context = await requireAppContext();
    const [projects, access] = await Promise.all([listVisibleProjects(context), loadWorkspaceAccess(context.workspace.id)]);
    const teams = access.teams.filter(team => context.member.teamIds?.includes(team.id)).map(team => team.name);
    // Only what is set: no relationship or teams leave their rows out
    const rows = [
        { label: t("Role"), value: context.member.role === 'admin' ? t("Workspace admin") : t("Commenter") },
        { label: t("Relationship"), value: context.member.relationship ? relationshipLabels[context.member.relationship] : undefined },
        { label: t("Teams"), value: teams.join(', ') || undefined },
        { label: t("Projects"), value: projects.map(project => project.name).join(', ') || 'None yet' }
    ].filter((row): row is { label: string; value: string } => Boolean(row.value));

    return (
        <>
            <AccountForm name={context.user.name} avatarUrl={avatarUrl(context.user)} />
            <AppLanguageForm language={userAppLanguage(context.user)} />
            <AppearanceSection />
            <ToolbarLanguageForm language={userToolbarLanguage(context.user)} />
            <Section id="my-access" title={t("Your workspace access")} description={t("Your role, teams and projects in {value1}.", { value1: context.workspace.name })}>
                <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
                    {rows.map(row => (
                        <div key={row.label} className="contents">
                            <dt className="text-muted-foreground">{t(row.label)}</dt>
                            <dd className="m-0 break-words">{row.value}</dd>
                        </div>
                    ))}
                </dl>
            </Section>
        </>
    );
}
