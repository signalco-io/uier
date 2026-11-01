import assert from 'node:assert/strict';
import test from 'node:test';
import { all, runtime } from '@pulumi/pulumi';

const resources = [];
runtime.setMocks({
    newResource(args) {
        resources.push(args);
        return { id: args.name, state: { ...args.inputs, base64: Buffer.alloc(32, 1).toString('base64') } };
    },
    call(args) { return args.inputs; },
}, 'uier', 'uier-production', true);

test('a deployed state inventory retains optional provider and rotation resources without their credentials', async () => {
    const keys = ['NOTION_CLIENT_SECRET', 'NOTION_TOKEN_KEY_PREVIOUS', 'NOTION_TOKEN_KEY_PREVIOUS_ID'];
    const previous = process.env.UIER_PREVIEW_ENV_METADATA;
    const configured = process.env.UIER_INTEGRATION_ENV;
    try {
        delete process.env.UIER_INTEGRATION_ENV;
        process.env.UIER_PREVIEW_ENV_METADATA = JSON.stringify(keys.map(key => ({
            name: `vercel-uier-env-integration-${key.toLowerCase().replaceAll('_', '-')}`, key, sensitive: false,
        })));
        const { integrationEnvironment } = await import('../dist/integrations.js');
        integrationEnvironment('fixture-project');
        // Resource registrations finish when the runtime drains its pending outputs.
        await new Promise(resolve => setImmediate(resolve));
        await all(resources.map(resource => resource.inputs.projectId ?? '')).promise();
        for (const key of keys) assert.ok(resources.some(resource => resource.inputs.key === key), key);
        assert.equal(resources.filter(resource => resource.type.endsWith(':RandomBytes')).length, 5);
        assert.ok(!resources.some(resource => resource.inputs.targets?.includes('preview')));
    } finally {
        if (previous === undefined) delete process.env.UIER_PREVIEW_ENV_METADATA; else process.env.UIER_PREVIEW_ENV_METADATA = previous;
        if (configured === undefined) delete process.env.UIER_INTEGRATION_ENV; else process.env.UIER_INTEGRATION_ENV = configured;
    }
});
