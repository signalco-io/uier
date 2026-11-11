import { comparisonMetadata } from '@/src/components/marketing/comparisons/content';
import { pageCardAlt, socialCardContentType, socialCardSize } from '@/src/lib/social/cards';
import { pageCardImage } from '@/src/lib/social/SocialCard';

const card = { ...comparisonMetadata('bugherd')!, section: 'Comparisons', path: '/compare/bugherd' };
export const alt = pageCardAlt(card);
export const size = socialCardSize;
export const contentType = socialCardContentType;
export default function Image() { return pageCardImage(card); }
