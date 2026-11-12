import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { loadStatusWorkflow } from '@/src/lib/app/statusWorkflows';

export const GET = reviewApiHandler(async ({ project }) => Response.json(await loadStatusWorkflow(project)));
export const OPTIONS = reviewPreflight('GET');
