import { finishLinearConnect } from '@/src/lib/integrations/linear';
import { integrationCallbackRoute } from '@/src/lib/integrations/routes';

export const dynamic = 'force-dynamic';
export const GET = integrationCallbackRoute('linear', finishLinearConnect);
