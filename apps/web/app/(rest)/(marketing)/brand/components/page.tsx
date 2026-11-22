import { publicPageMetadata } from '@/src/lib/metadata';
import { brand } from '@uier/brand';
import { ThemeToggle } from '@/src/components/brand/ThemeToggle';
import { catalog, type CatalogGroup } from '@/src/components/brand/catalog/catalog';
import { AppKitSpecimens } from '@/src/components/brand/catalog/AppKitSpecimens';
import { AppPatternSpecimens } from '@/src/components/brand/catalog/AppPatternSpecimens';
import { BrandMarkSpecimens, SiteKitSpecimens } from '@/src/components/brand/catalog/SiteSpecimens';
import { InlineLink, PageSection, Panel, Tile } from '@/src/components/marketing/ContentPage';
import { KnownPages } from '@/src/knownPages';

// The component catalog: every component people see, in the states it ships in, rendered from the
// same code as the site and the app. The review toolbar is on this page like on every public page,
// so a comment on a state is a proposal to change that component. The entries: src/components/brand/catalog.

const description = `Every ${brand.name} component in the states it ships in, for designers and developers to review and comment on.`;

export const metadata = publicPageMetadata(KnownPages.BrandComponents, { title: 'Components', description });

const catalogUrl = `${brand.repository}/tree/main/apps/web/src/components/brand/catalog`;

const specimens: Record<CatalogGroup['id'], () => React.ReactNode> = {
    'brand-marks': BrandMarkSpecimens,
    'site-kit': SiteKitSpecimens,
    'app-kit': AppKitSpecimens,
    'app-patterns': AppPatternSpecimens
};

export default function ComponentsPage() {
    return (
        <main className="flex flex-col pb-16">
            <header className="flex flex-wrap items-start justify-between gap-6 pt-12 md:pt-20">
                <div className="flex max-w-[720px] flex-col gap-5">
                    <a href={KnownPages.Brand} className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Brand</a>
                    <h1 className="text-[40px] font-semibold leading-[1.1] tracking-[-0.03em]">Components</h1>
                    <p className="text-lg leading-relaxed text-muted-foreground">
                        Every component in {brand.name}, in the states it ships in. Each one renders from the same code as the site and the app,
                        so a change shows here as it ships. Comment on any state to propose a change.
                    </p>
                </div>
                <ThemeToggle />
            </header>

            <PageSection id="how" title="How to use this page" wide>
                <Panel className="md:grid-cols-3">
                    <Tile title="Comment on a state">
                        <p>
                            Use the review toolbar at the bottom of the window and click the state you mean. The comment stays on that
                            state when others are added or moved.
                        </p>
                    </Tile>
                    <Tile title="Check both themes">
                        <p>
                            Switch between light and dark at the top. Overlays open from their buttons; turn on Keep open to comment on
                            an open menu, popover, select or tooltip.
                        </p>
                    </Tile>
                    <Tile title="Add a component">
                        <p>
                            Add an entry to <InlineLink href={catalogUrl}>the catalog</InlineLink> and render its states with the real
                            component. The rules for each one are on the <InlineLink href={KnownPages.Brand}>brand page</InlineLink>.
                        </p>
                    </Tile>
                </Panel>
            </PageSection>

            <nav aria-label="Components" className="grid grid-cols-1 gap-8 pt-16 sm:grid-cols-2 lg:grid-cols-4">
                {catalog.map(group => (
                    <div key={group.id} className="flex flex-col gap-3">
                        <a href={`#${group.id}`} className="text-sm font-semibold underline-offset-4 hover:underline">{group.title}</a>
                        <ul className="flex flex-col gap-1.5 text-sm">
                            {group.entries.map(entry => (
                                <li key={entry.id}>
                                    <a href={`#${entry.id}`} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{entry.name}</a>
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </nav>

            {catalog.map(group => {
                const Specimens = specimens[group.id];
                return (
                    <PageSection key={group.id} id={group.id} title={group.title} lead={group.lead} wide>
                        <div className="flex flex-col gap-6">
                            <Specimens />
                        </div>
                    </PageSection>
                );
            })}
        </main>
    );
}
