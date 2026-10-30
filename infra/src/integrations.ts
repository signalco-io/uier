import { secret, type Input } from '@pulumi/pulumi';
import { RandomBytes } from '@pulumi/random';
import { ProjectEnvironmentVariable } from '@pulumiverse/vercel';

const credentialNames = [
    'NOTION_CLIENT_ID', 'NOTION_CLIENT_SECRET',
    'LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET',
    'AZURE_DEVOPS_CLIENT_ID', 'AZURE_DEVOPS_CLIENT_SECRET', 'AZURE_DEVOPS_TENANT',
    'SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_APP_ID', 'SLACK_DISTRIBUTION_APPROVED',
    'UIER_GITHUB_APP_ID', 'UIER_GITHUB_APP_SLUG', 'UIER_GITHUB_CLIENT_ID', 'UIER_GITHUB_CLIENT_SECRET',
    'UIER_GITHUB_PRIVATE_KEY', 'UIER_GITHUB_WEBHOOK_SECRET',
] as const;
const encryptionKeys = [
    ['notion', 'NOTION_TOKEN_KEY'], ['linear', 'LINEAR_TOKEN_KEY'],
    ['slack', 'SLACK_TOKEN_KEY'], ['github-setup', 'UIER_GITHUB_SETUP_KEY'], ['azure-devops', 'AZURE_DEVOPS_TOKEN_KEY'],
] as const;
const allowedNames = new Set<string>([...credentialNames,
    ...encryptionKeys.flatMap(([, name]) => [name, `${name}_ID`, `${name}_PREVIOUS`, `${name}_PREVIOUS_ID`])]);
const keyId = /^[A-Za-z0-9_-]{1,32}$/;
function validEncryptionKey(value: string) {
    return /^[A-Za-z0-9+/]{43}=$/.test(value) && Buffer.from(value, 'base64').length === 32
        && Buffer.from(value, 'base64').toString('base64') === value;
}

/** Strict server-only allowlist. Errors deliberately contain neither names nor submitted values. */
export function parseIntegrationEnvironment(encoded: string | undefined): Record<string, string> {
    if (!encoded) return {};
    if (Buffer.byteLength(encoded) > 65_536) throw new Error('UIER_INTEGRATION_ENV is too large.');
    let parsed: unknown;
    try { parsed = JSON.parse(encoded); } catch { throw new Error('UIER_INTEGRATION_ENV must be a JSON string map.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('UIER_INTEGRATION_ENV must be a JSON string map.');
    const values: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed)) {
        if (!allowedNames.has(name)) throw new Error('UIER_INTEGRATION_ENV contains an unsupported variable.');
        if (typeof value !== 'string' || !value.trim() || value.length > 16_384 || value.includes('\0'))
            throw new Error('UIER_INTEGRATION_ENV values must be non-empty bounded strings.');
        values[name] = value;
    }
    if (values.SLACK_DISTRIBUTION_APPROVED !== undefined && !['0', '1'].includes(values.SLACK_DISTRIBUTION_APPROVED))
        throw new Error('UIER_INTEGRATION_ENV has an invalid distribution gate.');
    if (values.AZURE_DEVOPS_TENANT !== undefined && !/^(organizations|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(values.AZURE_DEVOPS_TENANT))
        throw new Error('UIER_INTEGRATION_ENV has an invalid Microsoft Entra tenant.');
    for (const [, name] of encryptionKeys) {
        const current = values[name]; const currentId = values[`${name}_ID`];
        const previous = values[`${name}_PREVIOUS`]; const previousId = values[`${name}_PREVIOUS_ID`];
        if (Boolean(current) !== Boolean(currentId) || (current && (!validEncryptionKey(current) || !keyId.test(currentId!)))
            || Boolean(previous) !== Boolean(previousId) || (previous && (!validEncryptionKey(previous) || !keyId.test(previousId!)))
            || (previous && (previousId === (currentId ?? 'k1') || previous === current)))
            throw new Error('UIER_INTEGRATION_ENV has an invalid encryption key rotation.');
    }
    return values;
}

/** New resources only: existing project, database, domains and email configuration are untouched. */
export function integrationEnvironment(projectId: Input<string>) {
    const configured = parseIntegrationEnvironment(process.env.UIER_INTEGRATION_ENV);
    const options = { deleteBeforeReplace: true };
    // The scheduled worker obtains production runtime configuration with Vercel env pull.
    // Write-only Sensitive values are excluded from that pull. Keep these retrievable/server-only;
    // Pulumi secret inputs still encrypt state and redact previews. Never log pulled values.
    const variable = (name: string, value: Input<string>, sensitive = false) => new ProjectEnvironmentVariable(
        `vercel-uier-env-integration-${name.toLowerCase().replaceAll('_', '-')}`,
        { projectId, key: name, value, targets: ['production'], sensitive }, options);
    for (const [provider, name] of encryptionKeys) {
        // Always register these stable protected resources, including while a provider is disabled
        // or an explicit rotation override is active. They are never implicitly regenerated.
        const generated = new RandomBytes(`uier-integration-key-${provider}`, { length: 32 },
            { protect: true, additionalSecretOutputs: ['base64', 'hex'] });
        variable(name, configured[name] ? secret(configured[name]) : generated.base64);
        variable(`${name}_ID`, secret(configured[`${name}_ID`] ?? 'k1'));
        for (const suffix of ['_PREVIOUS', '_PREVIOUS_ID']) {
            const value = configured[`${name}${suffix}`]; if (value) variable(`${name}${suffix}`, secret(value));
        }
    }
    for (const name of credentialNames) {
        const value = configured[name]; if (value) variable(name, secret(value));
    }
    variable('UIER_DEPLOYMENT_ENV', 'production', false);
}
