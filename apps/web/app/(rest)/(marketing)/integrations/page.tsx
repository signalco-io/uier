import type { PropsWithChildren } from 'react';
import { publicPageMetadata } from '@/src/lib/metadata';
import { Add, ArrowRight } from '@signalco/ui-icons';
import { CheckList, Chip, InlineLink, PageHeader, PageSection, Panel } from '../../../../src/components/marketing/ContentPage';
import { SuggestIntegrationButton } from '../../../../src/components/marketing/SuggestIntegrationButton';
import { IntegrationLogo } from '../../../../src/components/app/integrations/IntegrationLogo';
import { KnownPageLinks } from '../../../../src/knownPages';
import { integrationCatalog, type IntegrationCatalogEntry, type IntegrationCatalogKey } from '../../../../src/lib/integrations/catalog';
import { IntegrationsCover } from './IntegrationsCover';

export const metadata = publicPageMetadata('/integrations', { title: 'Integrations', description: 'Connect website feedback to Notion, GitHub, Linear, Azure DevOps and Slack.' });

const services = Object.entries(integrationCatalog) as [IntegrationCatalogKey, IntegrationCatalogEntry][];

/** A tile of the services grid; its link's area covers it, so the whole tile opens the guide */
const tile = 'group relative flex flex-col gap-5 p-6 transition-colors duration-[120ms] ease-out hover:bg-muted/50';
const tileLink = 'inline-flex items-center gap-1.5 text-sm font-medium text-foreground outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring';
const tileArrow = <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" className="text-muted-foreground transition-colors duration-[120ms] ease-out group-hover:text-foreground" />;

/** A rule with its point in strong and the rest muted, so the list reads at a glance */
function Rule({ children }: PropsWithChildren) {
    return <span className="text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">{children}</span>;
}

const shared = [
    <Rule><strong>Only shared feedback is sent.</strong> Private threads and the public uier showcase are excluded.</Rule>,
    <Rule><strong>A workspace admin connects</strong> each project and chooses its destination.</Rule>,
    <Rule><strong>Nothing is copied before you save a destination.</strong> Existing feedback waits for a backfill.</Rule>,
    <Rule>Two-way status sync and reply sync <strong>stay off until you turn them on.</strong></Rule>,
    <Rule><strong>Disconnect stops future sync</strong> and keeps the copies already made.</Rule>,
    <Rule><strong>Check availability in each guide.</strong> Provider listings and hosted verification have separate gates. Azure DevOps delivery and the optional reply-import workflow still need hosted verification.</Rule>
];

export default function IntegrationsPage() {
    return <main className="flex flex-col pb-16">
        <PageHeader title="Keep feedback with your work" lead="Connect a uier project to the tools your team uses. Each service has its own destination and controls." />
        <IntegrationsCover />
        <PageSection id="services" title="Choose a service" wide>
            {/* Five services and the way to ask for another: six tiles, so every row of two or three is full */}
            <Panel as="ul" className="md:grid-cols-2 lg:grid-cols-3">
                {services.map(([key, integration]) => (
                    <li key={key} className={tile}>
                        <IntegrationLogo provider={key} className="size-11 rounded-xl p-2.5" />
                        <div className="flex flex-col gap-1.5">
                            <h3 className="text-base font-semibold">{integration.name}</h3>
                            <p className="text-sm leading-relaxed text-muted-foreground">{integration.description}</p>
                        </div>
                        <div className="mt-auto flex flex-col gap-5">
                            <div className="flex flex-col gap-2">
                                <span className="text-xs text-muted-foreground">Optional</span>
                                <ul aria-label={`Optional for ${integration.name}`} className="flex flex-wrap gap-2">
                                    {integration.features.filter(feature => feature.optional).map(feature => <li key={feature.key}><Chip>{feature.title}</Chip></li>)}
                                </ul>
                            </div>
                            <a href={KnownPageLinks.integration(key)} className={tileLink}>Set up {integration.name}{tileArrow}</a>
                        </div>
                    </li>
                ))}
                <li className={tile}>
                    <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-xl border bg-background text-muted-foreground">
                        <Add size={20} strokeWidth={1.75} />
                    </span>
                    <div className="flex flex-col gap-1.5">
                        <h3 className="text-base font-semibold">Another tool</h3>
                        <p className="text-sm leading-relaxed text-muted-foreground">Tell us which one your team works in and what you would send to it.</p>
                    </div>
                    <a href="#suggest" className={`mt-auto ${tileLink}`}>Suggest an integration{tileArrow}</a>
                </li>
            </Panel>
        </PageSection>
        <PageSection id="shared" title="Every integration" lead="The same rules apply to each service.">
            <CheckList items={shared} />
            <p className="text-sm leading-relaxed text-muted-foreground">Need to compare the whole workflow? The <InlineLink href={KnownPageLinks.comparison('website-feedback-tools')}>website feedback tools comparison</InlineLink> covers capture, review and the handoff to your team’s tools.</p>
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
