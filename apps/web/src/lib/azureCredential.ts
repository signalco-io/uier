import { AzureCliCredential, ClientAssertionCredential } from '@azure/identity';
import { getVercelOidcToken } from '@vercel/oidc';

/** Explicit operator/worker CLI logins stay separate from deployed Vercel federation. */
export function azureDataCredential() {
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const mode = process.env.UIER_AZURE_AUTH_MODE;
    if (mode === 'operator') {
        if (!tenantId || process.env.UIER_DEPLOYMENT_ENV !== 'production' || process.env.NODE_ENV !== 'production'
            || process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL || process.env.GITHUB_ACTIONS === 'true')
            throw new Error('Operator Azure credentials require a standalone production command.');
        return new AzureCliCredential({ tenantId });
    }
    if (!tenantId || !clientId) throw new Error('Azure data access requires its tenant and client identifiers.');
    if (mode === 'github-actions') {
        if (process.env.GITHUB_ACTIONS !== 'true' || process.env.UIER_DEPLOYMENT_ENV !== 'production')
            throw new Error('The worker Azure credential requires a production GitHub Actions job.');
        return new AzureCliCredential({ tenantId });
    }
    if (mode) throw new Error('Unsupported Azure data credential mode.');
    return new ClientAssertionCredential(tenantId, clientId, () => getVercelOidcToken());
}
