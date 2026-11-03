import { brand } from '@uier/brand';
import { Button } from '@signalco/ui-primitives/Button';
import { PageHeader, PageSection, InlineLink } from '@/src/components/marketing/ContentPage';
import { publicPageMetadata } from '@/src/lib/metadata';
import { guides } from '@/src/lib/guides';
import { nextJsSnippet } from '@/src/lib/app/integration';
import { KnownPages } from '@/src/knownPages';

export const metadata = publicPageMetadata(guides.nextJs.path, guides.nextJs);

export default function NextJsGuide() {
    return <main className="flex flex-col pb-16">
        <PageHeader title={guides.nextJs.title} lead={guides.nextJs.description}>
            <Button variant="solid" href={KnownPages.App}>Create a project</Button>
        </PageHeader>
        <PageSection id="create-the-project" title="Create the project" lead="Add the exact addresses you will review.">
            <p className="text-base leading-relaxed">Sign in to uier and create a project for your site. Add its production or preview URL, then open the project’s installation guide. Copy the project code from the script tag shown there.</p>
        </PageSection>
        <PageSection id="add-the-script-to-your-root-layout" title="Add the script to your root layout" lead="Use next/script inside the App Router’s body element." wide>
            <p className="text-base leading-relaxed">Keep your existing layout and its children. Add the Script element below the children, replacing YOUR_PROJECT_CODE with the code from your project.</p>
            <pre tabIndex={0} aria-label="Next.js installation example" className="max-w-full overflow-x-auto rounded-xl border bg-muted p-4 text-sm leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><code>{nextJsSnippet(brand.url, 'YOUR_PROJECT_CODE')}</code></pre>
            <p className="text-sm leading-relaxed text-muted-foreground">This example comes from the same snippet generator as the project’s installation guide. It loads the toolbar after the page becomes interactive.</p>
        </PageSection>
        <PageSection id="check-the-installation" title="Check the installation">
            <ol className="flex list-decimal flex-col gap-4 pl-5 text-base leading-relaxed">
                <li>Deploy the layout change to an address configured in the project.</li>
                <li>Run the installation check from uier and open the review link it provides.</li>
                <li>Pin a test comment, open the inbox, and check that the comment appears in the project.</li>
                <li>Navigate to another page on the site and check the toolbar there too.</li>
            </ol>
        </PageSection>
        <PageSection id="if-the-toolbar-does-not-load" title="If the toolbar does not load" lead="Start with the project address and your browser’s console.">
            <p className="text-base leading-relaxed">Confirm that the script uses the copied project code and that the current site address is configured in that project. If the site sends a Content Security Policy, merge the sources shown in the installation guide into the existing directives. Keep any request nonces your app already requires.</p>
            <p className="text-base leading-relaxed">The script tag loads the toolbar. Project access settings still determine who can review the site.</p>
            <InlineLink href={guides.clientReviews.path}>Plan a client review</InlineLink>
        </PageSection>
    </main>;
}
