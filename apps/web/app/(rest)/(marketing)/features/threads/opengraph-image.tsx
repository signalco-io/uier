import { pageCardAlt, socialCardContentType, socialCardSize, type PageCard } from '@/src/lib/social/cards';
import { pageCardImage } from '@/src/lib/social/SocialCard';

// The page's social card: the same title and description as its metadata in page.tsx
const card: PageCard = {
    section: 'Features',
    title: 'Threads, mentions and assignees',
    description: 'Discuss each comment where it was left: reply with formatting and images, mention teammates, assign the people who fix it and follow replies by email.',
    path: '/features/threads'
};

export const alt = pageCardAlt(card);
export const size = socialCardSize;
export const contentType = socialCardContentType;

export default function Image() {
    return pageCardImage(card);
}
