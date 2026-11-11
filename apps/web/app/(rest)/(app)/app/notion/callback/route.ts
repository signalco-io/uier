import { finishNotionConnect } from '@/src/lib/integrations/notion';
import { integrationCallbackRoute } from '@/src/lib/integrations/routes';

export const GET = integrationCallbackRoute('notion', finishNotionConnect);
