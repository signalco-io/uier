import { Suspense } from 'react';
import { AccountApiTokensLoading } from '@/src/components/app/account/AccountLoading';
import { AccessTokens } from '@/src/components/app/mcp/AccessTokens';
import { requireAppContext } from '@/src/lib/app/context';
import { listVisibleProjects } from '@/src/lib/app/projects';
import { getAppI18n } from '@/src/lib/i18n/server';
import { listMcpCredentials } from '@/src/lib/mcp/credentials';

export async function generateMetadata() {
    const { t } = await getAppI18n();
    return { title: t('API tokens') };
}

async function ApiTokenSettings() {
    const context = await requireAppContext();
    const [projects, tokens] = await Promise.all([listVisibleProjects(context), listMcpCredentials(context.user.id, 'rest')]);
    return <AccessTokens rest projects={projects.map(({ id, name }) => ({ id, name }))}
        credentials={tokens.map(({ id, name, scopes, expiresAt, projectIds }) => ({ id, name, scopes, expiresAt, projectIds }))} />;
}

export default function ApiTokensPage() {
    return <Suspense fallback={<AccountApiTokensLoading />}><ApiTokenSettings /></Suspense>;
}
