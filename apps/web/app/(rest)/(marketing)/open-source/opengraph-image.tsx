import { brand } from '@uier/brand';
import { pageCardAlt, socialCardContentType, socialCardSize, type PageCard } from '@/src/lib/social/cards';
import { pageCardImage } from '@/src/lib/social/SocialCard';

// The page's social card: the same title and description as its metadata in page.tsx
const card: PageCard = {
    title: 'Open source',
    description: `${brand.name} is open source: the website, the comments API, the toolbar, the brand and the infrastructure are in one public repository.`,
    path: '/open-source'
};

export const alt = pageCardAlt(card);
export const size = socialCardSize;
export const contentType = socialCardContentType;

export default function Image() {
    return pageCardImage(card);
}
