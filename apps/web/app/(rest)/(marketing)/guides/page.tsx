import { PageHeader, PageSection, Panel, Tile, InlineLink } from '@/src/components/marketing/ContentPage';
import { publicPageMetadata } from '@/src/lib/metadata';
import { guides } from '@/src/lib/guides';

export const metadata = publicPageMetadata(guides.index.path, guides.index);

export default function GuidesPage() {
    return <main className="flex flex-col pb-16">
        <PageHeader title={guides.index.title} lead={guides.index.description} />
        <PageSection id="start-with-your-site" title="Start with your site" wide>
            <Panel>
                {[guides.clientReviews, guides.nextJs, guides.browserExtension].map(guide => <Tile key={guide.path} title={guide.title}>
                    <p>{guide.description}</p><InlineLink href={guide.path}>Read the guide</InlineLink>
                </Tile>)}
            </Panel>
        </PageSection>
    </main>;
}
