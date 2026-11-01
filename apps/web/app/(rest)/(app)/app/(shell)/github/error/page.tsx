import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader, Section } from '@/src/components/app/PageHeader';
import { Alert, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import { buttonVariants } from '@/src/components/ui/button';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';

export const metadata: Metadata = { title: 'GitHub connection not completed' };

export default function GitHubConnectionErrorPage() {
    return <>
        <PageHeader title="GitHub connection not completed" description="Return to your project settings to connect again." />
        <Section id="github-recovery" title="Start a new connection"
            description="uier could not verify this connection link. It may have expired or already been used. Check that you are signed in to the uier account that started the connection.">
            <div className="flex flex-col gap-5">
                <Alert>
                    <AlertTitle>Connecting an organization?</AlertTitle>
                    <AlertDescription>If GitHub asked for approval, an organization owner needs to approve the uier installation in GitHub. Once it is approved, open your project settings and connect GitHub again.</AlertDescription>
                </Alert>
                <div className="flex flex-wrap gap-2">
                    <Link href={KnownPages.AppProjects} className={buttonVariants()}>Go to projects</Link>
                    <Link href={KnownPageLinks.integration('github')} className={buttonVariants({ variant: 'outline' })}>GitHub setup guide</Link>
                </div>
            </div>
        </Section>
    </>;
}
