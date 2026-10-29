import { integrationConnectRoute } from '@/src/lib/integrations/routes';
import { beginSlackConnect } from '@/src/lib/integrations/slack/connection';
export const GET = integrationConnectRoute('slack', beginSlackConnect);
