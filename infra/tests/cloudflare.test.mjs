import assert from 'node:assert/strict';
import test from 'node:test';
import * as pulumi from '@pulumi/pulumi';

const resources = [];
pulumi.runtime.setMocks({
    newResource(args) {
        resources.push(args);
        return { id: args.name, state: args.inputs };
    },
    call: args => args.inputs,
}, 'uier', 'test');
pulumi.runtime.setConfig('uier:zoneid', 'test-zone');

test('CAA uses structured Cloudflare data without altering ordinary DNS records', async () => {
    const { caaRecord, dnsRecord } = await import('../dist/cloudflare.js');
    const caa = caaRecord('caa-test', '@', 'letsencrypt.org');
    const address = dnsRecord('address-test', '@', '76.76.21.21', 'A', true);
    await Promise.all([caa.urn.promise(), address.urn.promise()]);
    const caaInputs = resources.find(resource => resource.name === 'caa-test').inputs;
    assert.equal(caaInputs.type, 'CAA');
    assert.equal(caaInputs.zoneId.value, 'test-zone');
    assert.deepEqual(caaInputs.data, { flags: 0, tag: 'issue', value: 'letsencrypt.org' });
    assert.equal(caaInputs.content, undefined);
    const addressInputs = resources.find(resource => resource.name === 'address-test').inputs;
    assert.equal(addressInputs.content, '76.76.21.21');
    assert.equal(addressInputs.data, undefined);
});
