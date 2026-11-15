import { brand } from '@uier/brand';
import { pageCardAlt, socialCardContentType, socialCardSize, type PageCard } from '@/src/lib/social/cards';
import { pageCardImage } from '@/src/lib/social/SocialCard';

// The page's social card: the same title and description as its metadata in page.tsx
const card: PageCard = {
    section: 'Features',
    title: 'Fix verification for website feedback',
    description: `Enable optional fix checks for a project, then ask a reviewer to confirm an individual fix. ${brand.name} records who decided and when.`,
    path: '/features/fix-verification'
};

export const alt = pageCardAlt(card);
export const size = socialCardSize;
export const contentType = socialCardContentType;

export default function Image() {
    return pageCardImage(card);
}
