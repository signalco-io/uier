import type { IntegrationAdapter, IntegrationProviderId } from './model';

/** The production list grows only when a complete provider implementation ships. */
export const configuredIntegrationAdapters: readonly IntegrationAdapter[] = [];

export function integrationRegistry(adapters: readonly IntegrationAdapter[] = configuredIntegrationAdapters) {
    const entries = new Map<IntegrationProviderId, IntegrationAdapter>();
    for (const adapter of adapters) {
        if (entries.has(adapter.provider)) throw new Error('Duplicate integration provider');
        entries.set(adapter.provider, adapter);
    }
    return entries;
}
