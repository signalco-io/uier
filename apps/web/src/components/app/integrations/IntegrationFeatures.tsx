import { getAppI18n } from '@/src/lib/i18n/server';
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
export async function IntegrationFeatures({ provider, connection }: { provider: IntegrationProviderId; connection?: IntegrationConnection | null }) {
    const { t } = await getAppI18n();
    const integration = integrationCatalog[provider];
    return <Section id="features" title={t("What it does")} description={t("Optional features stay off until you turn them on.")}
        actions={<Link href={KnownPageLinks.integration(provider)} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            {t("Guide")}<span className="sr-only"> {t("to")}{' '}{integration.name}</span><ArrowUpRight data-icon="inline-end" />
        </Link>}>
        <ItemGroup aria-label={t("{value1} features", { value1: integration.name })} className="gap-2">
            {integration.features.map(feature => {
                const state = featureState(feature, connection);
                return <Item key={feature.key} role="listitem" variant="outline" size="sm" className="rounded-lg">
                    <ItemContent className="min-w-0">
                        <ItemTitle>{t(feature.title)}</ItemTitle>
                        <ItemDescription className="line-clamp-none">{t(feature.detail)}</ItemDescription>
                    </ItemContent>
                    {state && <ItemActions><Badge variant={state === 'On' ? "secondary" : "outline"}>{t(state)}</Badge></ItemActions>}
                </Item>;
            })}
        </ItemGroup>
    </Section>;
}
