import { notFound } from 'next/navigation';
import { brand } from '@uier/brand';
import { KnownPageLinks } from '@/src/knownPages';
import { integrationCatalog, isIntegrationCatalogKey } from '@/src/lib/integrations/catalog';
import { socialCardContentType, socialCardSize } from '@/src/lib/social/cards';
import { pageCardImage } from '@/src/lib/social/SocialCard';

// The integration's social card: its title and description from the catalog, as on the page, and the service's logo
export const alt = `${brand.name} integration`;
export const size = socialCardSize;
export const contentType = socialCardContentType;

export function generateStaticParams() {
    return Object.keys(integrationCatalog).map(provider => ({ provider }));
}

export default async function Image({ params }: { params: Promise<{ provider: string }> }) {
    const { provider } = await params;
    if (!isIntegrationCatalogKey(provider)) notFound();
    const integration = integrationCatalog[provider];
    return pageCardImage({ title: integration.title, description: integration.description, path: KnownPageLinks.integration(provider), provider });
}
