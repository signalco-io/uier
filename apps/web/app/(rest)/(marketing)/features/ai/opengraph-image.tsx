import { pageCardAlt, socialCardContentType, socialCardSize, type PageCard } from '@/src/lib/social/cards';
import { pageCardImage } from '@/src/lib/social/SocialCard';

// The page's social card: the same title and description as its metadata in page.tsx
const card: PageCard = {
    section: 'Features',
    title: 'AI for website feedback',
    description: `Connect Claude Code, Codex or Cursor to your site's feedback with the access you choose. In the toolbar, AI suggests rewrites for selected text.`,
    path: '/features/ai'
};

export const alt = pageCardAlt(card);
export const size = socialCardSize;
export const contentType = socialCardContentType;

export default function Image() {
    return pageCardImage(card);
}
