import { reviewQueryRoute, queryPreflight } from '@/src/lib/commentQuery/routes';

export const POST = reviewQueryRoute('query');
export const OPTIONS = queryPreflight;
