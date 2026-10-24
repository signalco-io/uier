import { Container } from '@signalco/ui-primitives/Container';
import { PageNav } from '@signalco/ui/Nav';
import { Logo } from '@uier/brand/Logo';

export default function RootMarketingLayout({ children, }: {
    children: React.ReactNode;
}) {
    return (
        <>
            <PageNav logo={<Logo size={18} />} />
            <Container className="pt-20">
                {children}
            </Container>
        </>
    );
}
