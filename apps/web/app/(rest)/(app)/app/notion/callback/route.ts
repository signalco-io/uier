import { finishNotionConnect } from '@/src/lib/integrations/notion';
import { integrationCallbackRoute } from '@/src/lib/integrations/routes';

export const dynamic = 'force-dynamic';
export const GET = integrationCallbackRoute('notion', finishNotionConnect);
