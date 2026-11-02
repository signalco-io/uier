import { brand } from '@uier/brand';
import { pageCardAlt, socialCardContentType, socialCardSize, type PageCard } from '@/src/lib/social/cards';
import { pageCardImage } from '@/src/lib/social/SocialCard';
import { KnownPages } from '@/src/knownPages';

// The page's social card: the same title and description as its metadata in page.tsx
const card: PageCard = {
    section: 'Features',
    title: 'Feedback triage',
    description: `Search a project's feedback, set priorities and assign, complete or reopen up to 50 selected threads at once in the ${brand.name} app.`,
    path: KnownPages.FeedbackTriage
};

export const alt = pageCardAlt(card);
export const size = socialCardSize;
export const contentType = socialCardContentType;

export default function Image() {
    return pageCardImage(card);
}
