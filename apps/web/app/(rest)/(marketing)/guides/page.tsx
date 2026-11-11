import { brand } from '@uier/brand';
import { PageHeader, SectionHeading } from '@/src/components/marketing/ContentPage';
import { GuideTeaser } from '@/src/components/marketing/guides/GuideLayout';
import { ClientReviewThumbnail, ExtensionThumbnail, NextJsThumbnail } from '@/src/components/marketing/guides/GuideSpecimens';
import { publicPageMetadata } from '@/src/lib/metadata';
import { guides } from '@/src/lib/guides';

export const metadata = publicPageMetadata(guides.index.path, guides.index);

// One card per guide (docs/guides.md); each card's title is its only link.

export default function GuidesPage() {
    return <main className="flex flex-col pb-16">
        <PageHeader title={guides.index.title} lead={guides.index.description} />
        <section id="start-with-your-site" aria-labelledby="start-with-your-site-title" className="flex flex-col gap-8 pt-16 md:pt-24">
            <SectionHeading
                id="start-with-your-site-title"
                title="Start with your site"
                lead={`Plan the review, then add ${brand.name} with the script or the browser extension.`} />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <GuideTeaser
                    wide
                    href={guides.clientReviews.path}
                    title={guides.clientReviews.title}
                    description={guides.clientReviews.description}
                    label="Review workflow"
                    picture={<ClientReviewThumbnail />} />
                <GuideTeaser
                    href={guides.nextJs.path}
                    title={guides.nextJs.title}
                    description={guides.nextJs.description}
                    label="Script"
                    picture={<NextJsThumbnail />} />
                <GuideTeaser
                    href={guides.browserExtension.path}
                    title={guides.browserExtension.title}
                    description={guides.browserExtension.description}
                    label="Browser extension"
                    picture={<ExtensionThumbnail />} />
            </div>
        </section>
    </main>;
}
