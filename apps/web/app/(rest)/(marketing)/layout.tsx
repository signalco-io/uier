import { Container } from '@signalco/ui-primitives/Container';
import { PageNav } from '@signalco/ui/Nav';
import { Button } from '@signalco/ui-primitives/Button';
import { Logo } from '@uier/brand/Logo';
import { SiteFooter } from '../../../src/components/marketing/SiteFooter';
import { KnownPages } from '../../../src/knownPages';
import { ToolbarScript } from '../../../src/components/toolbar/ToolbarScript';

const navLinks = [
    { text: 'How it works', href: KnownPages.HowItWorks },
    { text: 'Features', href: KnownPages.Features },
    { text: 'Pricing', href: KnownPages.Pricing },
    { text: 'FAQ', href: KnownPages.Faq }
];

export default function RootMarketingLayout({ children, }: {
    children: React.ReactNode;
}) {
    return (
        <>
            {/* /app: signed-out visitors go to sign in (proxy.ts), signed-in people straight into the app.
                These pages are static, so the label does not depend on the session. */}
            <PageNav logo={<Logo size={18} />} links={navLinks}>
                <Button variant="solid" href={KnownPages.App}>Sign in</Button>
            </PageNav>
            {/* While the review toolbar is mounted (showcase on public pages, review mode through review links),
                its pill sits at the bottom of the window (bottom 16px, 48px tall): the padding lets the
                end of the page scroll clear of it, and the scroll padding keeps focused links from
                scrolling underneath it */}
            <div className="[:root:has(#uier-toolbar)_&]:pb-24 [:root:has(#uier-toolbar):has(&)]:scroll-pb-24">
                <Container className="pt-20">
                    {children}
                </Container>
                <SiteFooter />
            </div>
            <ToolbarScript mode="showcase" />
        </>
    );
}
