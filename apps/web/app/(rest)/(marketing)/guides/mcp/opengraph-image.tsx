import { pageCardAlt, socialCardContentType, socialCardSize } from '@/src/lib/social/cards';
import { pageCardImage } from '@/src/lib/social/SocialCard';
import { mcpGuide } from '@/src/lib/guides/mcp';
export const alt = pageCardAlt(mcpGuide);
export const size = socialCardSize;
export const contentType = socialCardContentType;
export default function Image() { return pageCardImage(mcpGuide); }
