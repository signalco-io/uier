import { Logo } from '@uier/brand/Logo';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { InlineLink } from '@/src/components/marketing/ContentPage';
import { publicPageMetadata } from '@/src/lib/metadata';
import { Reference } from './Reference';

export const metadata = publicPageMetadata(KnownPages.DeveloperApi, { title: 'REST API reference',
    description: 'Connect your software to uier. Read project feedback, post replies and update thread statuses with a scoped API token.' });

export default function DeveloperApiPage() {
    return <>
        <header className="mx-auto flex max-w-5xl flex-col items-start gap-4 px-6 py-8">
            <a href={KnownPages.Landing} aria-label="uier"><Logo /></a>
            <h1 className="text-3xl font-semibold">REST API reference</h1>
            <p>Create a read-only token in <InlineLink href={KnownPageLinks.account('api-tokens')}>Account → API tokens</InlineLink> and choose a project.
                Set <code>UIER_API_TOKEN</code> in your environment, then list the projects the token can access.</p>
            <pre className="w-full overflow-x-auto rounded-lg border bg-muted p-4 text-sm"><code>{'curl https://uier.io/api/v1/projects \\\n  -H "Authorization: Bearer $UIER_API_TOKEN"'}</code></pre>
            <InlineLink href="/api/v1/openapi.json">Download the OpenAPI document</InlineLink>
        </header>
        <Reference />
    </>;
}
