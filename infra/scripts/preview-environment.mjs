import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Export stays encrypted. Only names and sensitivity flags enter the next step; no values.
let state;
try { state = JSON.parse(execFileSync('pulumi', ['stack', 'export', '--stack', 'organization/uier/uier-production'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })); }
catch { throw new Error('Could not read preview state metadata.'); }
const resources = state.deployment.resources.filter(resource => resource.type === 'vercel:index/projectEnvironmentVariable:ProjectEnvironmentVariable'
    && resource.inputs?.targets?.includes('production')).map(resource => ({
    name: resource.urn.split('::').at(-1), key: resource.inputs.key, sensitive: resource.inputs.sensitive,
}));
if (!process.env.GITHUB_ENV) throw new Error('The preview snapshot requires GitHub Actions.');
if (!resources.length) throw new Error('The preview snapshot contains no existing production variables.');
appendFileSync(process.env.GITHUB_ENV, `UIER_PREVIEW_ENV_METADATA=${JSON.stringify(resources)}\n`);
console.info(`Preserved metadata for ${resources.length} production variables; no values exported.`);
