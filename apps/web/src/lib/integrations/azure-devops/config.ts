import { isLocalRuntime } from '../../comments/environment';
import { isSecretKeyConfigured } from '../secrets';

/** Microsoft Entra resource id of Azure DevOps. Delegated scopes are `<resource>/<scope>`. */
export const AZURE_DEVOPS_RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798';
export const azureDevOpsScopes = [`${AZURE_DEVOPS_RESOURCE}/vso.work_write`, `${AZURE_DEVOPS_RESOURCE}/vso.profile`, 'offline_access'];

export function azureDevOpsKey() {
    return { key: process.env.AZURE_DEVOPS_TOKEN_KEY, keyId: process.env.AZURE_DEVOPS_TOKEN_KEY_ID ?? 'k1',
        previousKeys: process.env.AZURE_DEVOPS_TOKEN_KEY_PREVIOUS
            ? { [process.env.AZURE_DEVOPS_TOKEN_KEY_PREVIOUS_ID ?? 'k1']: process.env.AZURE_DEVOPS_TOKEN_KEY_PREVIOUS } : undefined };
}

function endpoint(value: string | undefined, fallback: string) {
    if (!isLocalRuntime() || !value) return fallback;
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        || url.username || url.password || url.hash) throw new Error('Invalid Azure DevOps test endpoint');
    return url.href.replace(/\/$/, '');
}

/** Entra apps do not support Microsoft accounts for the Azure DevOps resource, so work and school accounts only. */
function tenant() {
    const value = process.env.AZURE_DEVOPS_TENANT ?? 'organizations';
    if (!/^(organizations|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(value)) throw new Error('Invalid Azure DevOps tenant');
    return value;
}

export function azureDevOpsConfig() {
    const login = `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0`;
    return { clientId: process.env.AZURE_DEVOPS_CLIENT_ID ?? '', clientSecret: process.env.AZURE_DEVOPS_CLIENT_SECRET ?? '',
        apiUrl: endpoint(process.env.AZURE_DEVOPS_API_BASE_URL, 'https://dev.azure.com'),
        profileUrl: endpoint(process.env.AZURE_DEVOPS_PROFILE_BASE_URL, 'https://app.vssps.visualstudio.com'),
        authorizeUrl: endpoint(process.env.AZURE_DEVOPS_OAUTH_AUTHORIZE_URL, `${login}/authorize`),
        tokenUrl: endpoint(process.env.AZURE_DEVOPS_OAUTH_TOKEN_URL, `${login}/token`) };
}

export function isAzureDevOpsConfigured() {
    if (!isLocalRuntime() && (process.env.VERCEL_ENV === 'preview' || process.env.UIER_DEPLOYMENT_ENV === 'preview')) return false;
    try { const config = azureDevOpsConfig(); return Boolean(config.clientId && config.clientSecret && isSecretKeyConfigured(azureDevOpsKey())); }
    catch { return false; }
}

export function azureDevOpsCallback(baseUrl: string) {
    const url = new URL(baseUrl);
    if (url.username || url.password || (isLocalRuntime() ? !['http:', 'https:'].includes(url.protocol)
        : url.origin !== 'https://uier.io')) throw new Error('Invalid application URL');
    return new URL('/app/azure-devops/callback', url.origin).href;
}

/** Organization names: letters, digits and hyphens, starting and ending with a letter or digit. */
export function validOrganization(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,48}[A-Za-z0-9])?$/.test(value);
}
export function guid(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
