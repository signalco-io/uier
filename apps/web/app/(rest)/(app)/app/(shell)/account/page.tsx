import type { Metadata } from 'next';
import { Section } from '@/src/components/app/PageHeader';
import { requireAppContext } from '@/src/lib/app/context';
import { listVisibleProjects } from '@/src/lib/app/projects';
import { loadWorkspaceAccess } from '@/src/lib/app/access';
import { AccountForm, AppearanceSection } from './AccountForm';

export const metadata: Metadata = {
    title: 'Account'
};

/** General: the name, the theme and the person's access in the selected workspace */
export default async function AccountPage() {
    const context = await requireAppContext();
    const [projects, access] = await Promise.all([listVisibleProjects(context), loadWorkspaceAccess(context.workspace.id)]);
    return (
        <>
            <AccountForm name={context.user.name} />
            <AppearanceSection />
            <Section id="my-access" title="Your workspace access" description="Your teams and projects in the selected workspace.">
                <p className="m-0 text-sm">{context.member.role === 'admin' ? 'Workspace admin' : 'Commenter'} · {context.member.relationship ?? 'Unspecified'}</p>
                <p className="m-0 text-sm">Teams: {access.teams.filter(team => context.member.teamIds?.includes(team.id)).map(team => team.name).join(', ') || 'None'}</p>
                <p className="m-0 text-sm">Projects: {projects.map(project => project.name).join(', ') || 'None'}</p>
            </Section>
        </>
    );
}
