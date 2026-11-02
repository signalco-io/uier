import type { Metadata } from 'next';
import { brand } from '@uier/brand';

/** Public pages declare their own URL so queries and alternate hosts share one canonical. */
export function publicPageMetadata(path: string, { title, description = brand.shortDescription }: {
    title?: string;
    description?: string;
} = {}): Metadata {
    const socialTitle = title ? `${title} · ${brand.name}` : `${brand.name} · ${brand.tagline}`;
    const canonical = new URL(path, brand.url).href;
    return {
        ...(title ? { title } : {}),
        description,
        alternates: { canonical },
        openGraph: {
            type: 'website',
            siteName: brand.name,
            title: socialTitle,
            description,
            url: canonical
        },
        twitter: { card: 'summary_large_image', title: socialTitle, description }
    };
}
