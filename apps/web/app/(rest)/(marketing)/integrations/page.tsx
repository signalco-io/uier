import { publicPageMetadata } from '@/src/lib/metadata';
import { CheckList, Chip, InlineLink, PageHeader, PageSection, Panel } from '../../../../src/components/marketing/ContentPage';
import { SuggestIntegrationButton } from '../../../../src/components/marketing/SuggestIntegrationButton';
import { IntegrationLogo } from '../../../../src/components/app/integrations/IntegrationLogo';
import { KnownPageLinks } from '../../../../src/knownPages';
import { integrationCatalog, type IntegrationCatalogEntry, type IntegrationCatalogKey } from '../../../../src/lib/integrations/catalog';

export const metadata = publicPageMetadata('/integrations', { title: 'Integrations', description: 'Connect website feedback to Notion, GitHub, Linear, Azure DevOps and Slack.' });

const shared = [
    'Only shared feedback is sent. Private threads and the public uier showcase are excluded.',
    'A workspace admin connects each project and chooses its destination.',
    'Nothing is copied before you save a destination. Existing feedback waits for a backfill.',
    'Two-way status sync and reply sync stay off until you turn them on.',
    'Disconnect stops future sync and keeps the copies already made.'
];

export default function IntegrationsPage() {
    return <main className="flex flex-col pb-16">
        <PageHeader title="Keep feedback with your work" lead="Connect a uier project to the tools your team uses. Each service has its own destination and controls." />
        <PageSection id="services" title="Choose a service" wide>
            <Panel as="ul" className="md:grid-cols-2">
                {(Object.entries(integrationCatalog) as [IntegrationCatalogKey, IntegrationCatalogEntry][]).map(([key, integration]) => (
                    <li key={key} className="flex flex-col gap-4 p-6">
                        <div className="flex items-center gap-3">
                            <IntegrationLogo provider={key} />
                            <h3 className="text-base font-semibold">{integration.name}</h3>
                        </div>
                        <p className="text-sm leading-relaxed text-muted-foreground">{integration.description}</p>
                        <ul aria-label={`Optional for ${integration.name}`} className="flex flex-wrap gap-2">
                            {integration.features.filter(feature => feature.optional).map(feature => <li key={feature.key}><Chip>{feature.title}</Chip></li>)}
                        </ul>
                        <div className="mt-auto text-sm"><InlineLink href={KnownPageLinks.integration(key)}>Set up {integration.name}</InlineLink></div>
                    </li>
                ))}
            </Panel>
        </PageSection>
        <PageSection id="shared" title="Every integration" lead="The same rules apply to each service.">
            <CheckList items={shared} />
        </PageSection>
        <PageSection id="suggest" title="Suggest an integration" lead="Missing a tool your team works in? Tell us which one and what you would send to it.">
            <div className="flex flex-col gap-5 rounded-2xl border p-8">
                <p className="text-base leading-relaxed">The button opens the feedback form in the toolbar at the bottom of this window. Your suggestion goes straight to the uier team.</p>
                <SuggestIntegrationButton />
                <p className="text-sm leading-relaxed text-muted-foreground">Feedback on this page is public, so leave out personal information. You can also press + in the toolbar and pin a comment to a service above.</p>
            </div>
        </PageSection>
    </main>;
}
