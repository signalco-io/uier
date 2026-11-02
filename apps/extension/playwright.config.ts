import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { clientId, apiBase, port, localApi } from './e2e/environment';
export default defineConfig({
    testDir: './e2e', workers: 1, retries: 0, timeout: 120_000,
    reporter: [['list'], ['json', { outputFile: 'playwright-report/results.json' }]],
    use: { baseURL: apiBase, trace: 'retain-on-failure' },
    webServer: {
        command: `pnpm exec next start -p ${port}`, cwd: resolve(import.meta.dirname, '../web'),
        url: localApi, reuseExistingServer: false, timeout: 120_000,
        env: { UIER_LOCAL: '1', UIER_EXTENSION_CLIENT_IDS: clientId, UIER_BASE_URL: apiBase,
            COSMOSDB_CONNECTION_STRING: '', COSMOSDB_ENDPOINT: '', AZURE_SCREENSHOTS_CONNECTION_STRING: '', AZURE_SCREENSHOTS_ENDPOINT: '', AZURE_SCREENSHOTS_CONTAINER: '', UIER_BOTID_DEV_BYPASS: '' }
    }
});
