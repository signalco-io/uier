import { extensionPage } from '@/src/components/marketing/BrowserExtension';
import { pageCardAlt, socialCardContentType, socialCardSize } from '@/src/lib/social/cards';
import { pageCardImage } from '@/src/lib/social/SocialCard';

// The page's social card: the same title and description as its metadata in page.tsx
const card = extensionPage;
export const alt = pageCardAlt(card);
export const size = socialCardSize;
export const contentType = socialCardContentType;
export default function Image() { return pageCardImage(card); }
