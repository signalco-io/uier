import { useCases } from '@/src/lib/useCases';
import { pageCardAlt, socialCardContentType, socialCardSize } from '@/src/lib/social/cards';
import { pageCardImage } from '@/src/lib/social/SocialCard';

const card = useCases.clientFeedback;
export const alt = pageCardAlt(card);
export const size = socialCardSize;
export const contentType = socialCardContentType;

export default function Image() {
    return pageCardImage(card);
}
