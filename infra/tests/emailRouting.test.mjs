import assert from 'node:assert/strict';
import test from 'node:test';
import * as pulumi from '@pulumi/pulumi';

const destination = { id: 'destination-id', email: 'destination@example.test', verified: '2026-01-01' };
const legacy = { id: 'legacy-id', enabled: false, name: 'Existing rule', priority: 7, source: 'api',
    matchers: [{ type: 'literal', field: 'to', value: 'existing@uier.io' }],
    actions: [{ type: 'forward', values: [destination.email] }] };
const registrations = [];
const calls = [];
const options = new Map();
pulumi.runtime.setMocks({
    newResource(args) {
        registrations.push(args);
        return { id: args.id || args.name, state: { ...args.inputs, supportSubaddress: true } };
    },
    call(args) {
        calls.push(args);
        if (args.token.includes('getZone:')) return { name: 'uier.io', account: { id: 'account-id' } };
        if (args.token.includes('getEmailRoutingSettings:')) return { enabled: true, status: 'ready' };
        if (args.token.includes('getEmailRoutingCatchAll:')) return { enabled: false, name: 'Drop all', source: 'api', actions: [{ type: 'drop', values: [] }], matchers: [{ type: 'all' }] };
        if (args.token.includes('getEmailRoutingAddresses:')) return { results: [destination] };
        if (args.token.includes('getEmailRoutingRules:')) return { results: [legacy] };
        if (args.token.includes('getEmailRoutingRule:')) return legacy;
        throw new Error(`Unexpected invoke: ${args.token}`);
    },
}, 'uier', 'test');
pulumi.runtime.setConfig('uier:zoneid', 'zone-id');
const { emailRoutingPlan, emailRouting } = await import('../dist/emailRouting.js');

test('plans exact imports and only missing requested aliases, stable after deployment', () => {
    const plan = emailRoutingPlan([destination], [legacy]);
    assert.deepEqual(plan.rules[0], { name: 'email-routing-existing-legacy-id', rule: legacy, importId: legacy.id });
    assert.deepEqual(plan.rules.slice(1).map(item => item.rule.matchers[0].value), ['contact@uier.io', 'security@uier.io', 'privacy@uier.io']);
    assert.ok(plan.rules.slice(1).every(item => item.rule.actions[0].values[0] === destination.email && item.rule.enabled));
    const liveRules = plan.rules.map((item, i) => ({ ...item.rule, id: item.rule.id || `created-${i}` }));
    const second = emailRoutingPlan([destination], liveRules);
    assert.deepEqual(second.rules.map(item => item.name), plan.rules.map(item => item.name));
    assert.ok(second.rules.every(item => item.importId));
});

test('rejects ambiguous/unverified destinations, conflicting/duplicate aliases and Worker rules', () => {
    assert.throws(() => emailRoutingPlan([], []), /exactly one verified/);
    assert.throws(() => emailRoutingPlan([{ ...destination, verified: '' }], []), /exactly one verified/);
    const other = { ...destination, id: 'other' };
    assert.throws(() => emailRoutingPlan([destination, other], []), /exactly one verified/);
    assert.equal(emailRoutingPlan([destination, other], [], 'destination-id').destination.id, destination.id);
    const conflict = { ...legacy, matchers: [{ type: 'literal', field: 'to', value: 'security@uier.io' }] };
    assert.throws(() => emailRoutingPlan([destination], [conflict]), /conflicts/);
    const valid = { ...conflict, enabled: true };
    assert.throws(() => emailRoutingPlan([destination], [valid, { ...valid, id: 'duplicate' }]), /Duplicate/);
    assert.throws(() => emailRoutingPlan([destination], [{ ...legacy, source: 'wrangler' }]), /Worker-managed/);
});

test('runtime discovers IDs, imports without rewriting inputs and protects every adopted resource', async () => {
    await pulumi.runtime.runInPulumiStack(async () => {
        pulumi.runtime.registerStackTransformation(args => { options.set(args.name, args.opts); return undefined; });
        await emailRouting().promise();
    });
    const managed = registrations.filter(item => item.type.startsWith('cloudflare:') && item.name !== 'email-routing-settings-live');
    assert.equal(managed.length, 7);
    assert.ok(managed.every(item => item.type.startsWith('cloudflare:index/emailRouting')));
    assert.ok(managed.every(item => options.get(item.name).protect === true));
    assert.equal(options.get('email-routing-settings').import, 'zone-id');
    assert.equal(options.get('email-routing-destination').import, 'account-id/destination-id');
    assert.equal(options.get('email-routing-existing-legacy-id').import, 'zone-id/legacy-id');
    assert.equal(options.get('email-routing-catch-all').import, 'zone-id');
    assert.equal(managed.find(item => item.name === 'email-routing-settings').inputs.supportSubaddress, true);
    const imported = managed.find(item => item.name === 'email-routing-existing-legacy-id').inputs;
    assert.deepEqual(imported.matchers, legacy.matchers);
    assert.equal(imported.priority, 7);
    assert.equal(imported.enabled, false);
    assert.equal(imported.name, legacy.name);
    assert.equal(imported.actions[pulumi.runtime.specialSigKey], pulumi.runtime.specialSecretSig);
    assert.equal(managed.find(item => item.name === 'email-routing-destination').inputs.email[pulumi.runtime.specialSigKey], pulumi.runtime.specialSecretSig);
    assert.equal(managed.find(item => item.name === 'email-routing-catch-all').inputs.enabled, false);
    for (const alias of ['contact', 'security', 'privacy']) {
        const opts = options.get(`email-routing-${alias}`);
        assert.equal(opts.import, undefined);
        assert.equal(opts.dependsOn.length, 4);
    }
    assert.equal(calls.find(item => item.token.includes('getEmailRoutingRules:')).inputs.enabled, undefined);
    assert.equal(calls.find(item => item.token.includes('getEmailRoutingAddresses:')).inputs.verified, true);
});
