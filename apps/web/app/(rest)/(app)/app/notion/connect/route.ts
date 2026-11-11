import { beginNotionConnect } from '@/src/lib/integrations/notion';
import { integrationConnectRoute } from '@/src/lib/integrations/routes';

export const GET = integrationConnectRoute('notion', beginNotionConnect);
