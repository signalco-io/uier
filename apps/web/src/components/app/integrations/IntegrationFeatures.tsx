import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { KnownPageLinks } from '@/src/knownPages';
import { integrationCatalog, type IntegrationFeature } from '@/src/lib/integrations/catalog';
import type { IntegrationConnection, IntegrationProviderId } from '@/src/lib/integrations/model';
import { Badge } from '@/src/components/ui/badge';
import { buttonVariants } from '@/src/components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/src/components/ui/item';
import { Section } from '../PageHeader';

/** Where an optional feature stands: on or off for a connection, else that it is optional */
function featureState(feature: IntegrationFeature, connection?: IntegrationConnection | null) {
    if (!feature.optional) return undefined;
    if (connection && feature.key === 'two-way-status') return connection.twoWaySync === true ? 'On' : 'Off';
    if (connection && feature.key === 'reply-sync') return connection.replySync?.enabled === true ? 'On' : 'Off';
    return 'Optional';
}

/**
 * What a service does with the project's shared feedback, from the same catalog as its public page
 * (`/integrations/<provider>`). With a connection, two-way status sync and reply sync say whether they are on.
 */
export function IntegrationFeatures({ provider, connection }: { provider: IntegrationProviderId; connection?: IntegrationConnection | null }) {
    const integration = integrationCatalog[provider];
    return <Section id="features" title="What it does" description="Optional features stay off until you turn them on."
        actions={<Link href={KnownPageLinks.integration(provider)} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Guide<span className="sr-only"> to {integration.name}</span><ArrowUpRight data-icon="inline-end" />
        </Link>}>
        <ItemGroup aria-label={`${integration.name} features`} className="gap-2">
            {integration.features.map(feature => {
                const state = featureState(feature, connection);
                return <Item key={feature.key} role="listitem" variant="outline" size="sm" className="rounded-lg">
                    <ItemContent className="min-w-0">
                        <ItemTitle>{feature.title}</ItemTitle>
                        <ItemDescription className="line-clamp-none">{feature.detail}</ItemDescription>
                    </ItemContent>
                    {state && <ItemActions><Badge variant={state === 'On' ? 'secondary' : 'outline'}>{state}</Badge></ItemActions>}
                </Item>;
            })}
        </ItemGroup>
    </Section>;
}
