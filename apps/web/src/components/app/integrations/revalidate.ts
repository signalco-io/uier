import { revalidatePath } from 'next/cache';
import { KnownPageLinks } from '@/src/knownPages';
import type { IntegrationProviderId } from '@/src/lib/integrations/model';

/** After a settings action: the provider's page and the Integrations overview, which lists its status */
export function revalidateIntegration(projectId: string, provider: IntegrationProviderId) {
    revalidatePath(KnownPageLinks.projectIntegration(projectId, provider));
    revalidatePath(KnownPageLinks.projectSettings(projectId, 'integrations'));
}
