import { brand } from '@uier/brand';
import { pageCardAlt, socialCardContentType, socialCardSize, type PageCard } from '@/src/lib/social/cards';
import { pageCardImage } from '@/src/lib/social/SocialCard';

// The page's social card: the same title and description as its metadata in page.tsx
const card: PageCard = {
    section: 'Brand',
    title: 'Components',
    description: `Every ${brand.name} component in the states it ships in, for designers and developers to review and comment on.`,
    path: '/brand/components'
};

export const alt = pageCardAlt(card);
export const size = socialCardSize;
export const contentType = socialCardContentType;

export default function Image() {
    return pageCardImage(card);
}
