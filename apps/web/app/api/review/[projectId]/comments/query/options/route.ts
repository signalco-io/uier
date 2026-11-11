import { reviewQueryRoute, queryPreflight } from '@/src/lib/commentQuery/routes';

export const POST = reviewQueryRoute('options');
export const OPTIONS = queryPreflight;
