import { pageCardAlt, socialCardContentType, socialCardSize } from '@/src/lib/social/cards';
import { pageCardImage } from '@/src/lib/social/SocialCard';
import { guides } from '@/src/lib/guides';
const card = guides.reviewChecklist;
export const alt = pageCardAlt(card);
export const size = socialCardSize;
export const contentType = socialCardContentType;
export default function Image() { return pageCardImage(card); }
