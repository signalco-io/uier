import { reviewQueryRoute, queryPreflight } from '@/src/lib/commentQuery/routes';

export const POST = reviewQueryRoute('counts');
export const OPTIONS = queryPreflight;
