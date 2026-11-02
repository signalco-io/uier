import { test, expect } from '@playwright/test';
import { azureDataCredential } from '../src/lib/azureCredential';

test('worker credentials require the explicit production Actions context; requests retain Vercel federation', () => {
    const names = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'UIER_AZURE_AUTH_MODE', 'GITHUB_ACTIONS', 'UIER_DEPLOYMENT_ENV'];
    const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
    try {
        process.env.AZURE_TENANT_ID = 'c7837eb3-77ca-413b-8653-c97b08886678';
        process.env.AZURE_CLIENT_ID = '11a15260-e6c1-438a-95b3-aa51c8ec641c';
        delete process.env.UIER_AZURE_AUTH_MODE;
        expect(azureDataCredential().constructor.name).toBe('ClientAssertionCredential');
        process.env.UIER_AZURE_AUTH_MODE = 'github-actions';
        process.env.GITHUB_ACTIONS = 'false'; process.env.UIER_DEPLOYMENT_ENV = 'production';
        expect(() => azureDataCredential()).toThrow('production GitHub Actions');
        process.env.GITHUB_ACTIONS = 'true'; process.env.UIER_DEPLOYMENT_ENV = 'preview';
        expect(() => azureDataCredential()).toThrow('production GitHub Actions');
        process.env.UIER_DEPLOYMENT_ENV = 'production';
        expect(azureDataCredential().constructor.name).toBe('AzureCliCredential');
        process.env.UIER_AZURE_AUTH_MODE = 'implicit-fallback';
        expect(() => azureDataCredential()).toThrow('Unsupported Azure');
    } finally {
        for (const name of names) {
            if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
        }
    }
});
