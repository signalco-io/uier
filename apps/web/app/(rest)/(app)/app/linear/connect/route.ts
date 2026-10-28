import { beginLinearConnect } from '@/src/lib/integrations/linear';
import { integrationConnectRoute } from '@/src/lib/integrations/routes';

export const dynamic = 'force-dynamic';
export const GET = integrationConnectRoute('linear', beginLinearConnect);
