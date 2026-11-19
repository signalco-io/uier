import { brand } from '@uier/brand';
import { KnownPageLinks } from '@/src/knownPages';
import { integrationCatalog } from '@/src/lib/integrations/catalog';
import type { IntegrationProviderId } from '@/src/lib/integrations/model';
import { socialCardContentType, socialCardSize } from '@/src/lib/social/cards';
import { pageCardImage } from '@/src/lib/social/SocialCard';

// The integration's social card: its title and description from the catalog, as on the page, and the service's logo
export const alt = `${brand.name} integration`;
export const size = socialCardSize;
export const contentType = socialCardContentType;

export function integrationCardImage(provider: IntegrationProviderId) {
    const integration = integrationCatalog[provider];
    return pageCardImage({ title: integration.title, description: integration.description, path: KnownPageLinks.integration(provider), provider });
}
