import { AzureCliCredential, ClientAssertionCredential } from '@azure/identity';
import { getVercelOidcToken } from '@vercel/oidc';

/** Workers use their dedicated GitHub login; deployed requests use Vercel federation. */
export function azureDataCredential() {
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    if (!tenantId || !clientId) throw new Error('Azure data access requires its tenant and client identifiers.');
    const mode = process.env.UIER_AZURE_AUTH_MODE;
    if (mode === 'github-actions') {
        if (process.env.GITHUB_ACTIONS !== 'true' || process.env.UIER_DEPLOYMENT_ENV !== 'production')
            throw new Error('The worker Azure credential requires a production GitHub Actions job.');
        return new AzureCliCredential({ tenantId });
    }
    if (mode) throw new Error('Unsupported Azure data credential mode.');
    return new ClientAssertionCredential(tenantId, clientId, () => getVercelOidcToken());
}
