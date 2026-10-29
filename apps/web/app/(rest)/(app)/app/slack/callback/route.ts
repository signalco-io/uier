import { integrationCallbackRoute } from '@/src/lib/integrations/routes';
import { finishSlackConnect } from '@/src/lib/integrations/slack/connection';
export const GET = integrationCallbackRoute('slack', finishSlackConnect);
