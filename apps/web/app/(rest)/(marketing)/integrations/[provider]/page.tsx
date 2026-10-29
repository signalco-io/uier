import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Button } from '@signalco/ui-primitives/Button';
import { brand } from '@uier/brand';
import { InlineLink, PageHeader, PageSection, Panel, Tile } from '../../../../../src/components/marketing/ContentPage';
import { KnownPages } from '../../../../../src/knownPages';
import { integrationCatalog, isIntegrationCatalogKey } from '../../../../../src/lib/integrations/catalog';

type Props = { params: Promise<{ provider: string }> };

export function generateStaticParams() {
    return Object.keys(integrationCatalog).map(provider => ({ provider }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { provider } = await params;
    if (!isIntegrationCatalogKey(provider)) return {};
    const integration = integrationCatalog[provider];
    return { title: integration.title, description: integration.description };
}

export default async function IntegrationPage({ params }: Props) {
    const { provider } = await params;
    if (!isIntegrationCatalogKey(provider)) notFound();
    const integration = integrationCatalog[provider];
    return <main className="flex flex-col pb-16">
        <PageHeader title={integration.title} lead={integration.description}>
            <div className="flex flex-wrap items-center gap-2.5">
                <Button variant="solid" size="lg" href={KnownPages.App}>Set up {integration.name}</Button>
                <Button variant="outlined" size="lg" href={`mailto:${brand.contact.email}`}>Get help</Button>
            </div>
        </PageHeader>
        <PageSection id="overview" title={integration.result} lead={integration.detail} wide>
            {/* A static product illustration, not a screenshot of a customer workspace. */}
            <img src={`/integrations/${provider}-showcase.png`} width={1600} height={1000}
                alt={`Illustration of feedback moving from uier to ${integration.name}`}
                className="h-auto w-full rounded-2xl border" />
        </PageSection>
        <PageSection id="setup" title="Get connected" lead="Start in the project you want to connect.">
            <ol className="flex list-decimal flex-col gap-4 pl-5 text-base leading-relaxed">
                {integration.steps.map(step => <li key={step} className="pl-2">{step}</li>)}
            </ol>
        </PageSection>
        <PageSection id="access" title="Access and data" lead="Each project chooses its own destination.">
            <Panel>
                <Tile title="Permissions"><p>{integration.access}</p></Tile>
                <Tile title="What to expect"><p>{integration.limits}</p></Tile>
                <Tile title="Privacy and disconnect"><p>Private feedback and the public uier showcase are excluded.</p><p>{integration.removal}</p></Tile>
            </Panel>
            <p className="text-sm leading-relaxed text-muted-foreground">Read the <InlineLink href={KnownPages.LegalPrivacyPolicy}>privacy policy</InlineLink> and <InlineLink href={KnownPages.LegalTermsOfService}>terms of service</InlineLink>.</p>
        </PageSection>
        <PageSection id="help" title="Help and pricing" lead={brand.pricing}>
            <p className="text-base leading-relaxed">For setup, account or sync problems, email <InlineLink href={`mailto:${brand.contact.email}`}>{brand.contact.email}</InlineLink>. Include the provider and what happened. Keep credentials and private feedback out of your message.</p>
            <p className="text-sm leading-relaxed text-muted-foreground">You can also <InlineLink href={brand.issues}>report a product issue</InlineLink> or read about <InlineLink href={KnownPages.Security}>security</InlineLink>.</p>
        </PageSection>
    </main>;
}
