import { brand } from '@uier/brand';
import { KnownPages } from '../../knownPages';
import { Footer1 } from './Footer1';

// The footer of every public page (rendered by the marketing layout). Contact and social
// destinations come from @uier/brand; labels are sentence case like everything else.

export function SiteFooter() {
    return (
        <Footer1
            features={[
                {
                    header: 'Product',
                    ctas: [
                        { label: 'How it works', href: KnownPages.HowItWorks },
                        { label: 'Features', href: KnownPages.Features },
                        { label: 'Integrations', href: KnownPages.Integrations },
                        { label: 'Pricing', href: KnownPages.Pricing },
                        { label: 'FAQ', href: KnownPages.Faq },
                        { label: 'Status', href: KnownPages.Status }
                    ]
                },
                {
                    header: 'Resources',
                    ctas: [
                        { label: 'Open source', href: KnownPages.OpenSource },
                        { label: 'Security', href: KnownPages.Security },
                        { label: 'Brand', href: KnownPages.Brand },
                        { label: 'GitHub', href: brand.social.github }
                    ]
                },
                {
                    header: 'Contact',
                    ctas: [
                        { label: brand.contact.email, href: `mailto:${brand.contact.email}` },
                        { label: 'Report an issue', href: brand.issues },
                        { label: 'signalco on X', href: brand.social.x }
                    ]
                },
                {
                    header: 'Legal',
                    ctas: [
                        { label: 'Privacy policy', href: KnownPages.LegalPrivacyPolicy },
                        { label: 'Terms of service', href: KnownPages.LegalTermsOfService },
                        { label: 'Cookie policy', href: KnownPages.LegalCookiePolicy },
                        { label: 'Acceptable use policy', href: KnownPages.LegalAcceptableUsePolicy },
                        { label: 'SLA', href: KnownPages.LegalSla }
                    ]
                }
            ]} />
    );
}
