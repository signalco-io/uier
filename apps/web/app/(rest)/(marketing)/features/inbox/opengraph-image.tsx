import { pageCardAlt, socialCardContentType, socialCardSize, type PageCard } from '@/src/lib/social/cards';
import { pageCardImage } from '@/src/lib/social/SocialCard';

// The page's social card: the same title and description as its metadata in page.tsx
const card: PageCard = {
    section: 'Features',
    title: 'Website feedback inbox',
    description: 'Every thread on the page and the rest of the site in the toolbar’s inbox. Search, pick a page or an environment, and see what is unread or assigned to you.',
    path: '/features/inbox'
};

export const alt = pageCardAlt(card);
export const size = socialCardSize;
export const contentType = socialCardContentType;

export default function Image() {
    return pageCardImage(card);
}
