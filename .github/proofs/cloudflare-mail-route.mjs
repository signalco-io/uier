import { resolveMx } from 'node:dns/promises';

export function mailAlias() {
    const address = process.env.UIER_PROOF_EMAIL_ALIAS;
    if (!address || address.length > 90 || !/^[a-z0-9][a-z0-9._-]{0,22}@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(address)
        || /^(?:contact|security|privacy)@uier\.io$/.test(address))
        throw new Error('Set UIER_PROOF_EMAIL_ALIAS to a dedicated literal mailbox.');
    return address;
}

/** Only creates the designated missing literal rule. Existing aliases and catch-all are read-only. */
export async function verifyOrCreateMailRoute(target, { apply = false, lookupMx = resolveMx } = {}) {
    const address = mailAlias();
    const domain = address.split('@')[1];
    const zoneId = process.env.UIER_PROOF_EMAIL_ZONE_ID;
    const account = process.env.CLOUDFLARE_ACCOUNT_ID;
    const token = process.env.CLOUDFLARE_API_TOKEN;
    const id = /^[a-f0-9]{32}$/;
    if (!token || !id.test(zoneId) || !id.test(account))
        throw new Error('Set the dedicated Cloudflare token, account ID and Email Routing zone ID.');
    if (!['preview', 'production'].includes(target)) throw new Error('Set a valid proof provider environment.');
    const worker = 'uier-proof-mail-' + target;
    const zoneUrl = 'https://api.cloudflare.com/client/v4/zones/' + zoneId;
    async function request(path, body) {
        const failure = 'Cloudflare did not confirm the required proof Email Routing operation.';
        let response;
        let data;
        try {
            response = await fetch(zoneUrl + path, { method: body ? 'POST' : 'GET', redirect: 'error',
                headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
                body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
            data = await response.json();
        } catch {
            throw new Error(failure);
        }
        if (!response.ok || !data?.success) throw new Error(failure + ' HTTP ' + response.status + '.');
        return data;
    }
    const { result: zone } = await request('');
    if (zone?.id !== zoneId || zone.account?.id !== account)
        throw new Error('The routing zone must belong to the configured Cloudflare Worker account.');
    const routing = '/email/routing';
    const { result: settings } = await request(routing);
    if (!settings || typeof zone.name !== 'string' || settings.name !== zone.name
        || !(domain === zone.name || domain.endsWith('.' + zone.name))
        || !settings.enabled || settings.status !== 'ready' || settings.support_subaddress !== true)
        throw new Error('Enable Email Routing and plus addressing for the configured zone before running this workflow.');
    const mx = await lookupMx(domain);
    if (!mx.some(entry => /^route[1-3]\.mx\.cloudflare\.net\.?$/i.test(entry.exchange)))
        throw new Error('The configured mail hostname must have Cloudflare Email Routing MX records.');
    const rootAliases = new Set(['contact@uier.io', 'security@uier.io', 'privacy@uier.io']);
    async function exactRule() {
        const matches = [];
        const protectedRules = [];
        for (let page = 1; page <= 20; page++) {
            const results = await request(routing + '/rules?page=' + page + '&per_page=50');
            if (!Array.isArray(results.result)) throw new Error('Unexpected Cloudflare routing rule inventory.');
            matches.push(...results.result.filter(rule => rule.matchers?.some(matcher => matcher.value?.toLowerCase() === address)));
            if (settings.name === 'uier.io') protectedRules.push(...results.result.filter(rule =>
                rule.matchers?.some(matcher => rootAliases.has(matcher.value?.toLowerCase()))));
            const totalPages = results.result_info?.total_pages;
            if (Number.isSafeInteger(totalPages) ? page >= totalPages : results.result.length < 50) break;
            if (page === 20) throw new Error('The routing rule inventory exceeded the inspection limit.');
        }
        if (matches.length > 1) throw new Error('Multiple Cloudflare rules currently match the proof alias.');
        let rule;
        if (matches.length) {
            const ruleId = matches[0].id;
            if (!id.test(ruleId)) throw new Error('Could not identify the existing Cloudflare proof rule.');
            ({ result: rule } = await request(routing + '/rules/' + ruleId));
            if (!(rule?.id === ruleId && rule.enabled && rule.source !== 'wrangler' && rule.matchers?.length === 1
                && rule.matchers[0].type === 'literal' && rule.matchers[0].field === 'to'
                && rule.matchers[0].value?.toLowerCase() === address
                && rule.actions?.length === 1 && rule.actions[0].type === 'worker'
                && rule.actions[0].value?.length === 1 && rule.actions[0].value[0] === worker))
                throw new Error('A different Cloudflare rule already claims the designated proof alias.');
        }
        const catchAll = settings.name === 'uier.io' ? (await request(routing + '/rules/catch_all')).result : null;
        if (settings.name === 'uier.io' && catchAll?.enabled !== false)
            throw new Error('The protected uier.io catch-all must be confirmed disabled.');
        const protectedState = JSON.stringify({ catchAll, rules: protectedRules.sort((a, b) => a.id.localeCompare(b.id)) });
        return { rule, protectedState };
    }
    const existing = await exactRule();
    if (apply && !existing.rule) {
        await request(routing + '/rules', { name: 'uier test proof email (' + target + ')', enabled: true,
            matchers: [{ type: 'literal', field: 'to', value: address }], actions: [{ type: 'worker', value: [worker] }] });
        const verified = await exactRule();
        if (!verified.rule || verified.protectedState !== existing.protectedState)
            throw new Error('Readback did not confirm the proof alias and preserved root rules.');
    }
    if (apply) console.info('Verified the designated Cloudflare proof alias and its Worker action.');
}
