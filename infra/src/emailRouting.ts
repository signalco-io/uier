import * as cloudflare from '@pulumi/cloudflare';
import { Config, all, secret } from '@pulumi/pulumi';

type Rule = Pick<cloudflare.GetEmailRoutingRuleResult, 'id' | 'actions' | 'matchers' | 'enabled' | 'name' | 'priority' | 'source'>;
type Address = { id: string; email: string; verified: string };
const aliases = ['contact', 'security', 'privacy'] as const;
const maxItems = 1000;

/** Pure adoption plan: never change an existing rule as part of an import. */
export function emailRoutingPlan(addresses: Address[], rules: Rule[], destinationId?: string) {
    const verified = addresses.filter(address => address.verified && (!destinationId || address.id === destinationId));
    if (verified.length !== 1) throw new Error('Email Routing needs exactly one verified destination; set uier:emailRoutingDestinationId to select an existing address.');
    const destination = verified[0]!;
    if (!destination.id || !destination.email) throw new Error('Email Routing destination is incomplete.');
    const planned = rules.map(rule => {
        if (!rule.id || rule.source !== 'api') throw new Error('Cannot adopt an incomplete or Worker-managed Email Routing rule.');
        const alias = aliases.find(alias => rule.matchers.some(matcher => matcher.value?.toLowerCase() === `${alias}@uier.io`));
        if (alias && !(rule.enabled && rule.matchers.length === 1 && rule.matchers[0]?.type === 'literal'
            && rule.matchers[0]?.field === 'to' && rule.actions.length === 1 && rule.actions[0]?.type === 'forward'
            && rule.actions[0]?.values.length === 1 && rule.actions[0]?.values[0] === destination.email))
            throw new Error('An existing Email Routing rule conflicts with a requested address; review it before adoption.');
        return { name: alias ? `email-routing-${alias}` : `email-routing-existing-${rule.id}`, rule, importId: rule.id };
    });
    if (new Set(planned.map(item => item.name)).size !== planned.length) throw new Error('Duplicate Email Routing rules for a requested address.');
    for (const alias of aliases) {
        const name = `email-routing-${alias}`;
        if (!planned.some(item => item.name === name)) planned.push({ name, importId: '', rule: {
            id: '', name: `uier ${alias}`, enabled: true, priority: 0, source: 'api',
            matchers: [{ type: 'literal', field: 'to', value: `${alias}@uier.io` }],
            actions: [{ type: 'forward', values: [destination.email] }],
        } });
    }
    return { destination, rules: planned };
}

/** CI-only runtime lookups resolve import IDs; no DNS resources are registered here. */
export function emailRouting() {
    const config = new Config();
    const destinationId = config.get('emailRoutingDestinationId');
    return config.requireSecret('zoneid').apply(async zoneId => {
        const zone = await cloudflare.getZone({ zoneId });
        if (zone.name !== 'uier.io' || !zone.account.id) throw new Error('Expected the uier.io Cloudflare zone and account.');
        const [settings, catchAll, addresses, listedRules] = await Promise.all([
            cloudflare.getEmailRoutingSettings({ zoneId }),
            cloudflare.getEmailRoutingCatchAll({ zoneId }),
            cloudflare.getEmailRoutingAddresses({ accountId: zone.account.id, verified: true, maxItems }),
            cloudflare.getEmailRoutingRules({ zoneId, maxItems }),
        ]);
        if (!settings.enabled || settings.status !== 'ready') throw new Error('Existing Email Routing must be enabled and ready before adoption.');
        if (catchAll.enabled || catchAll.source !== 'api') throw new Error('Email Routing catch-all must remain disabled and API-managed.');
        if (addresses.results.length >= maxItems || listedRules.results.length >= maxItems)
            throw new Error('Email Routing discovery reached its limit; refusing a partial import.');
        // Catch-all can appear in the list but only supports the separate catch_all endpoint.
        // The list invoke omits source; fetch each ordinary rule's full writable inputs.
        const ordinaryRules = listedRules.results.filter(rule =>
            !(catchAll.id && rule.id === catchAll.id) && !rule.matchers.some(matcher => matcher.type === 'all'));
        const rules = await Promise.all(ordinaryRules.map(rule => cloudflare.getEmailRoutingRule({ zoneId, ruleIdentifier: rule.id })));
        const plan = emailRoutingPlan(addresses.results, rules, destinationId);
        // The settings invoke omits supportSubaddress in this SDK. Read the resource so its
        // optional writable setting is imported exactly, including a live true value.
        const liveSettings = cloudflare.EmailRoutingSettings.get('email-routing-settings-live', zoneId, { zoneId });
        const adoptedSettings = new cloudflare.EmailRoutingSettings('email-routing-settings', {
            zoneId, supportSubaddress: liveSettings.supportSubaddress,
        }, { protect: true, import: zoneId });
        const destination = new cloudflare.EmailRoutingAddress('email-routing-destination', {
            accountId: zone.account.id, email: secret(plan.destination.email),
        }, { protect: true, import: `${zone.account.id}/${plan.destination.id}`, additionalSecretOutputs: ['email'] });
        const adoptedCatchAll = new cloudflare.EmailRoutingCatchAll('email-routing-catch-all', {
            zoneId, enabled: false, name: catchAll.name, source: catchAll.source,
            actions: secret(catchAll.actions), matchers: catchAll.matchers,
        }, { protect: true, import: zoneId, additionalSecretOutputs: ['actions'] });
        const adoptedRules = plan.rules.filter(item => item.importId).map(item => registerRule(item));
        function registerRule(item: typeof plan.rules[number], existing: cloudflare.EmailRoutingRule[] = []) {
            const { id: _id, ...inputs } = item.rule;
            return new cloudflare.EmailRoutingRule(item.name, {
                ...inputs, zoneId, actions: secret(inputs.actions),
            }, {
                protect: true, import: item.importId ? `${zoneId}/${item.importId}` : undefined,
                additionalSecretOutputs: ['actions'],
                dependsOn: [adoptedSettings, destination, adoptedCatchAll, ...existing],
            });
        }
        // Complete adoption before creating the requested missing rules.
        const addedRules = plan.rules.filter(item => !item.importId).map(item => registerRule(item, adoptedRules));
        return all([...adoptedRules, ...addedRules].map(rule => rule.urn)).apply(urns => urns.length);
    });
}
