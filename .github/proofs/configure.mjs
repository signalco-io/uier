import { copyFileSync, chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mailAlias, verifyOrCreateMailRoute } from './cloudflare-mail-route.mjs';

const [feature, directory] = process.argv.slice(2);
const value = name => {
    const setting = process.env[name]?.trim();
    if (!setting) throw new Error('Missing required CI setting ' + name + '.');
    return setting;
};
function origin(name) {
    const url = new URL(value(name));
    if (url.protocol !== 'https:' || url.origin !== value(name)) throw new Error(name + ' must be an HTTPS origin.');
    return url;
}
const target = value('PROOF_TARGET');
if (!['preview', 'production'].includes(target)) throw new Error('Select a deployment target.');
if (feature === 'html') {
    const url = origin('UIER_PROOF_HTML_ORIGIN');
    if (/(^|\.)uier\.io$|\.vercel\.app$/i.test(url.hostname)) throw new Error('Use a separate, dedicated prototype hostname.');
    const deployment = origin('UIER_PROOF_DEPLOYMENT');
    if (!deployment.hostname.endsWith('.vercel.app')) throw new Error('Use the exact Vercel deployment URL.');
    const endpoint = new URL('/v13/deployments/' + deployment.hostname, 'https://api.vercel.com');
    endpoint.searchParams.set('teamId', value('VERCEL_ORG_ID'));
    const response = await fetch(endpoint, { headers: { Authorization: 'Bearer ' + value('VERCEL_TOKEN') }, redirect: 'error' });
    if (!response.ok) throw new Error('Could not verify the intended Vercel deployment.');
    const deployed = await response.json();
    if (deployed.projectId !== value('VERCEL_PROJECT_ID') || deployed.readyState !== 'READY'
        || (deployed.target === 'production' ? 'production' : 'preview') !== target)
        throw new Error('The deployment does not belong to the requested project and target.');
} else if (feature === 'mail') {
    const alias = mailAlias();
    await verifyOrCreateMailRoute(target);
    const account = value('CLOUDFLARE_ACCOUNT_ID');
    if (!/^[0-9a-f]{32}$/.test(account)) throw new Error('Invalid Cloudflare account ID.');
    const secret = value('UIER_PROOF_EMAIL_SECRET');
    if (secret.length < 32) throw new Error('The proof relay secret must be at least 32 characters.');
    copyFileSync(new URL('./mail-worker.mjs', import.meta.url), join(directory, 'mail-worker.mjs'));
    writeFileSync(join(directory, 'wrangler.json'), JSON.stringify({
        name: 'uier-proof-mail-' + target, account_id: account, main: './mail-worker.mjs', compatibility_date: '2026-11-19',
        workers_dev: false, preview_urls: false,
        vars: { UIER_PROOF_EMAIL_ALIAS: alias, UIER_PROOF_APP_ORIGIN: origin('UIER_PROOF_APP_ORIGIN').origin },
        secrets: { required: ['UIER_PROOF_EMAIL_SECRET', ...(process.env.UIER_PROOF_VERCEL_BYPASS ? ['UIER_PROOF_VERCEL_BYPASS'] : [])] }
    }));
    const path = join(directory, 'proof-secrets.json');
    writeFileSync(path, JSON.stringify({ UIER_PROOF_EMAIL_SECRET: secret,
        ...(process.env.UIER_PROOF_VERCEL_BYPASS ? { UIER_PROOF_VERCEL_BYPASS: process.env.UIER_PROOF_VERCEL_BYPASS } : {}) }), { mode: 0o600 });
    chmodSync(path, 0o600);
} else if (feature === 'mail-rule') await verifyOrCreateMailRoute(target, { apply: true });
else throw new Error('Choose HTML or mail.');
