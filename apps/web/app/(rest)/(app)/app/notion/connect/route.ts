import { beginNotionConnect } from '@/src/lib/integrations/notion';
import { integrationConnectRoute } from '@/src/lib/integrations/routes';

export const dynamic = 'force-dynamic';
export const GET = integrationConnectRoute('notion', beginNotionConnect);
