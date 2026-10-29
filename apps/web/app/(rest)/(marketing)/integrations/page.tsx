import type { Metadata } from 'next';
import { InlineLink, PageHeader, PageSection, Panel, Tile } from '../../../../src/components/marketing/ContentPage';
import { KnownPageLinks } from '../../../../src/knownPages';
import { integrationCatalog } from '../../../../src/lib/integrations/catalog';

export const metadata: Metadata = { title: 'Integrations', description: 'Connect website feedback to Notion, GitHub, Linear and Slack.' };

export default function IntegrationsPage() {
    return <main className="flex flex-col pb-16">
        <PageHeader title="Keep feedback with your work" lead="Connect a uier project to the tools your team uses. Each service has its own destination and controls." />
        <PageSection id="services" title="Choose a service" wide>
            <Panel className="md:grid-cols-2">
                {Object.entries(integrationCatalog).map(([key, integration]) => <Tile key={key} title={integration.name}>
                    <p>{integration.description}</p>
                    <InlineLink href={KnownPageLinks.integration(key)}>Set up {integration.name}</InlineLink>
                </Tile>)}
            </Panel>
        </PageSection>
    </main>;
}
