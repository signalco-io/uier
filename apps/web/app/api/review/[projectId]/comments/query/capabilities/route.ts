import { reviewQueryRoute, queryPreflight } from '@/src/lib/commentQuery/routes';

export const GET = reviewQueryRoute('capabilities');
export const OPTIONS = queryPreflight;
