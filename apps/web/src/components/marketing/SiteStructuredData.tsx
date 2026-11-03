import { brand } from '@uier/brand';

export const siteStructuredData = {
    '@context': 'https://schema.org',
    '@graph': [{
        '@type': 'WebSite',
        '@id': `${brand.url}/#website`,
        name: brand.name,
        url: brand.url,
        description: brand.shortDescription,
        inLanguage: 'en',
        isAccessibleForFree: true,
        sameAs: [brand.repository],
        publisher: { '@id': `${brand.parent.url}/#organization` }
    }, {
        '@type': 'Organization',
        '@id': `${brand.parent.url}/#organization`,
        name: brand.parent.name,
        url: brand.parent.url,
        email: brand.contact.email,
        sameAs: [brand.social.x]
    }]
};

export function SiteStructuredData() {
    return <script type="application/ld+json" dangerouslySetInnerHTML={{
        __html: JSON.stringify(siteStructuredData).replace(/</g, '\\u003c')
    }} />;
}
