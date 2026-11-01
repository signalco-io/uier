import { execFileSync } from 'node:child_process';
import { workerSettingNames, parseWorkerSettings } from '../../apps/web/scripts/worker-settings.mjs';

// Owner operation for initial setup/rotation. Secret values stay in memory and go to gh on stdin.
function command(executable, args, options = {}) {
    try { return execFileSync(executable, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options }); }
    catch { throw new Error('Worker configuration command failed; no credential output was retained.'); }
}
const account = JSON.parse(command('az', ['account', 'show', '--query', '{id:id,tenantId:tenantId}', '-o', 'json']));
if (account.id !== 'd22db5bd-ca9a-447c-9b1b-dc56aca401d7' || account.tenantId !== 'c7837eb3-77ca-413b-8653-c97b08886678')
    throw new Error('Select the uier Azure tenant/subscription before configuring the worker.');
const environment = JSON.parse(command('gh', ['api', 'repos/signalco-io/uier/environments/production-worker']));
const policies = JSON.parse(command('gh', ['api', 'repos/signalco-io/uier/environments/production-worker/deployment-branch-policies'])).branch_policies;
if (!environment.deployment_branch_policy?.custom_branch_policies || policies.length !== 1
    || policies[0].name !== 'main' || policies[0].type !== 'branch')
    throw new Error('The worker environment must allow only the main branch.');
let state;
try { state = JSON.parse(command('pulumi', ['stack', 'export', '--stack', 'organization/uier/uier-production', '--show-secrets'],
    { env: { ...process.env, PULUMI_BACKEND_URL: 'azblob://states', AZURE_STORAGE_ACCOUNT: 'sastate2a61d506' } })); }
catch { throw new Error('Could not read the deployed worker settings.'); }
function plaintext(value) {
    if (value && typeof value === 'object' && value['4dabf18193072939515e22adb298388d'] === '1b47061264138c4ac30d75fd1eb44270') {
        try { return plaintext(JSON.parse(value.plaintext)); }
        catch { throw new Error('A deployed worker setting could not be decoded.'); }
    }
    return value;
}
const variables = state.deployment.resources.filter(resource => resource.type === 'vercel:index/projectEnvironmentVariable:ProjectEnvironmentVariable');
const settings = Object.fromEntries(variables.filter(resource => resource.inputs.targets?.includes('production')
    && workerSettingNames.has(resource.inputs.key)).map(resource => [resource.inputs.key, plaintext(resource.inputs.value)]));
const endpoints = new Set(variables.filter(resource => resource.inputs.key === 'COSMOSDB_ENDPOINT').map(resource => plaintext(resource.inputs.value)));
if (endpoints.size !== 1) throw new Error('The deployed Cosmos endpoint is ambiguous or missing.');
settings.COSMOSDB_ENDPOINT = [...endpoints][0];
const encoded = JSON.stringify(settings);
parseWorkerSettings(encoded);
command('gh', ['secret', 'set', 'UIER_WORKER_SETTINGS', '--repo', 'signalco-io/uier', '--env', 'production-worker'], { input: encoded });
console.info(`Stored ${Object.keys(settings).length} allowlisted settings in production-worker. No account or deployment keys included.`);
