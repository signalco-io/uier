import { brand } from '@uier/brand';
import { cacheLife } from 'next/cache';
import { KnownPages } from '../../knownPages';
import { Footer1 } from './Footer1';

// The footer of every public page (rendered by the marketing layout). Contact and social
// destinations come from @uier/brand; labels are sentence case like everything else.

export async function SiteFooter() {
    'use cache';
    cacheLife('hours');
    return (
        <Footer1
            features={[
                {
                    header: 'Product',
                    ctas: [
                        { label: 'How it works', href: KnownPages.HowItWorks },
                        { label: 'Features', href: KnownPages.Features },
                        { label: 'Feedback triage', href: KnownPages.FeedbackTriage },
                        { label: 'Fix verification', href: KnownPages.FixVerification },
                        { label: 'AI features', href: KnownPages.Ai },
                        { label: 'Page checks', href: KnownPages.PageChecks },
                        { label: 'Integrations', href: KnownPages.Integrations },
                        { label: 'Browser extension', href: KnownPages.BrowserExtension },
                        { label: 'Pricing', href: KnownPages.Pricing },
                        { label: 'FAQ', href: KnownPages.Faq },
                        { label: 'Status', href: KnownPages.Status }
                    ]
                },
                {
                    header: 'Resources',
                    ctas: [
                        { label: 'Guides', href: KnownPages.Guides },
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
                        { label: 'Report an issue', href: brand.issues }
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
