import type { Metadata } from 'next';
import { AuthCard } from '@/src/components/app/AuthCard';

export const metadata: Metadata = {
    title: 'Cannot connect'
};

/**
 * An authorization request that cannot go back to its coding tool (GET /api/oauth/authorize).
 * Signed out too. It never links outside uier: the request's addresses are not trusted.
 */
const problems: Record<string, { title: string; description: string }> = {
    invalid_client: {
        title: 'uier does not recognize this app',
        description: 'The coding tool sent an app registration that is unknown, expired or could not be read. Connect again from your coding tool. If this keeps happening, update the coding tool.'
    },
    invalid_redirect_uri: {
        title: 'This app cannot be sent back',
        description: 'The coding tool asked to return to an address it did not register. uier stopped here and sent nothing back. Connect again from your coding tool.'
    },
    invalid_request: {
        title: 'This sign-in request is incomplete',
        description: 'The coding tool did not send everything uier needs. Connect again from your coding tool.'
    }
};
const fallback = { title: 'This sign-in cannot continue', description: 'Connect again from your coding tool.' };

export default async function ConnectErrorPage({ searchParams }: PageProps<'/app/connect/error'>) {
    const { error } = await searchParams;
    const problem = (typeof error === 'string' && Object.hasOwn(problems, error) ? problems[error] : undefined) ?? fallback;
    return (
        <AuthCard title={problem.title} description={problem.description}>
            <p className="m-0 text-sm text-muted-foreground">You can close this tab.</p>
        </AuthCard>
    );
}
