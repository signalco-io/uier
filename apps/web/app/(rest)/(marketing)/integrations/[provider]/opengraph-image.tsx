import { notFound } from 'next/navigation';
import { integrationCatalog, isIntegrationCatalogKey } from '@/src/lib/integrations/catalog';
import { integrationCardImage } from '@/src/lib/social/integrationCard';
export { alt, size, contentType } from '@/src/lib/social/integrationCard';

// Keep previously published social image URLs working after moving the guides to static routes.
export function generateStaticParams() {
    return Object.keys(integrationCatalog).map(provider => ({ provider }));
}

export default async function Image({ params }: { params: Promise<{ provider: string }> }) {
    const { provider } = await params;
    if (!isIntegrationCatalogKey(provider)) notFound();
    return integrationCardImage(provider);
}
