import { copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mailAlias, verifyOrCreateMailRoute } from './cloudflare-mail-route.mjs';
import { configureHtml, setMailEnvironment, verifyMailOrigin } from './vercel.mjs';

const [feature, directory] = process.argv.slice(2);
const target = process.env.PROOF_TARGET;
if (target !== 'preview' && target !== 'production') throw new Error('Select a deployment target.');

if (feature === 'html') {
    await configureHtml(target);
} else if (feature === 'mail') {
    const alias = mailAlias();
    const appOrigin = await verifyMailOrigin(target);
    await verifyOrCreateMailRoute(target);

    const secret = process.env.UIER_PROOF_EMAIL_SECRET;
    if (!secret || !/^[!-~]{32,505}$/.test(secret))
        throw new Error('Use an independent proof relay secret of 32 to 505 printable ASCII characters without spaces.');
    const bypass = process.env.UIER_PROOF_VERCEL_BYPASS?.trim();
    const secrets = { UIER_PROOF_EMAIL_SECRET: secret, ...(bypass ? { UIER_PROOF_VERCEL_BYPASS: bypass } : {}) };
    copyFileSync(new URL('./mail-worker.mjs', import.meta.url), join(directory, 'mail-worker.mjs'));
    writeFileSync(join(directory, 'wrangler.json'), JSON.stringify({
        name: 'uier-proof-mail-' + target,
        account_id: process.env.CLOUDFLARE_ACCOUNT_ID,
        main: './mail-worker.mjs',
        compatibility_date: '2026-11-19',
        workers_dev: false,
        preview_urls: false,
        vars: {
            UIER_PROOF_EMAIL_ALIAS: alias,
            UIER_PROOF_APP_ORIGIN: appOrigin,
            UIER_PROOF_VERCEL_BYPASS_ENABLED: bypass ? '1' : '0'
        },
        secrets: { required: Object.keys(secrets) }
    }));
    writeFileSync(join(directory, 'proof-secrets.json'), JSON.stringify(secrets), { mode: 0o600, flag: 'wx' });
    await setMailEnvironment(target, alias, secret);
    console.info('Verified the mail destination, Cloudflare route and target app environment.');
} else if (feature === 'mail-rule') {
    await verifyOrCreateMailRoute(target, { apply: true });
} else {
    throw new Error('Choose HTML or mail.');
}
