import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { reviewActivitySummary } from '@/src/lib/review/readRoutes';
export const dynamic = 'force-dynamic';
export const GET = reviewApiHandler(reviewActivitySummary);
export const OPTIONS = reviewPreflight('GET');
