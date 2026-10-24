// Vendored from @signalco/cms-components-marketing (signalco monorepo sources): the published
// npm build (0.1.2) bundles Next.js' CommonJS next/link and breaks App Router prerendering.
// Adjusted for the uier brand: lockup instead of a text logo, short copyright line.
import { Typography } from '@signalco/ui-primitives/Typography';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Link } from '@signalco/ui-primitives/Link';
import { Divider } from '@signalco/ui-primitives/Divider';
import { cx } from '@signalco/ui-primitives/cx';
import { Container } from '@signalco/ui-primitives/Container';
import { SectionData } from '@signalco/cms-core/SectionData';
import { brand } from '@uier/brand';
import { Logo } from '@uier/brand/Logo';
import { Ctas2 } from './Ctas2';

/**
 * The footer component with a logo, links, social media icons and system status option.
 * Pass feature with tagline "SystemStatus" and asset as component for system status to display system status option.
 *
 * @param props The props for the Footer1 component
 * @returns A React component
 */
export function Footer1({ asset, features, ctas }: SectionData) {
    const sectionsFeatures = features?.filter(section => section.ctas?.length && section.tagline !== 'SystemStatus');
    const systemStatusFeature = features?.find(section => section.tagline === 'SystemStatus');

    return (
        <footer className="self-stretch">
            <Container className="pb-8 pt-16">
                <Stack spacing={4}>
                    {sectionsFeatures && (
                        <div
                            className={cx(
                                'grid grid-cols-1 gap-8 md:grid-cols-2',
                                sectionsFeatures.length === 3 && 'lg:grid-cols-3',
                                sectionsFeatures.length >= 4 && 'lg:grid-cols-4'
                            )}>
                            {sectionsFeatures.map(section => (
                                <Stack key={section.header} spacing={4} className="min-w-[220px]">
                                    <Typography level="h6" component="h2">{section.header}</Typography>
                                    {section.ctas && (
                                        <Stack spacing={1.5}>
                                            {section.ctas.map(link => (
                                                <Link key={link.label} href={link.href}>
                                                    <Typography level="body2" className="text-muted-foreground hover:text-foreground/80">{link.label}</Typography>
                                                </Link>
                                            ))}
                                        </Stack>
                                    )}
                                </Stack>
                            ))}
                        </div>
                    )}
                    <div className="flex flex-col items-center gap-4 md:flex-row md:justify-between">
                        <Stack className="items-center md:items-start" alignItems="center">
                            {asset ?? <Logo size={16} />}
                        </Stack>
                        <Ctas2 ctas={ctas} />
                    </div>
                    <Divider />
                    <div className="flex flex-col items-center gap-8 text-center md:flex-row md:justify-between">
                        <div>
                            {systemStatusFeature?.asset}
                        </div>
                        <Typography level="body3">
                            © {new Date().getFullYear()} {brand.name} · <Link href={brand.parent.url}>A {brand.parent.name} project</Link>
                        </Typography>
                    </div>
                </Stack>
            </Container>
        </footer>
    )
}
