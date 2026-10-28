import type { IntegrationAdapter, IntegrationProviderId } from './model';
import { notionAdapter } from './notion';
import { githubAdapter } from './github';
import { linearAdapter } from './linear';
import { slackAdapter } from './slack';

// Providers also use shared authority helpers. Resolve their exports only when called, after
// module initialization, so route bundles and the standalone worker share a cycle-safe registry.
function deferredAdapter(provider: IntegrationProviderId, resolve: () => IntegrationAdapter): IntegrationAdapter {
    return { provider, isConfigured: () => resolve().isConfigured(),
        get maxRunMs() { return resolve().maxRunMs; }, get maxCalls() { return resolve().maxCalls; },
        deliver: context => resolve().deliver(context),
        maintenance: options => resolve().maintenance?.(options) ?? Promise.resolve({ calls: 0 }),
        externalLink: (connection, ledger) => resolve().externalLink?.(connection, ledger) ?? null,
        validateExternalLink: (url, connection, ledger) => resolve().validateExternalLink?.(url, connection, ledger) ?? false,
        async revokeAdmin(workspaceId, userId) { await resolve().revokeAdmin?.(workspaceId, userId); }
    };
}
export const configuredIntegrationAdapters: readonly IntegrationAdapter[] = [deferredAdapter('notion', () => notionAdapter),
    deferredAdapter('github', () => githubAdapter), deferredAdapter('linear', () => linearAdapter), deferredAdapter('slack', () => slackAdapter)];

export function integrationRegistry(adapters: readonly IntegrationAdapter[] = configuredIntegrationAdapters) {
    const entries = new Map<IntegrationProviderId, IntegrationAdapter>();
    for (const adapter of adapters) {
        if (entries.has(adapter.provider)) throw new Error('Duplicate integration provider');
        entries.set(adapter.provider, adapter);
    }
    return entries;
}
