import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const port = Number(process.env.PORT || 4004);
const baseURL = `http://127.0.0.1:${port}`;
const clientId = readFileSync(resolve(import.meta.dirname, 'dist-test/development-id.txt'), 'utf8').trim();
export default defineConfig({
    testDir: './e2e', workers: 1, retries: 0, timeout: 60_000,
    reporter: [['list'], ['json', { outputFile: 'playwright-report/results.json' }]],
    use: { baseURL, trace: 'retain-on-failure' },
    webServer: {
        command: `pnpm exec next start -p ${port}`, cwd: resolve(import.meta.dirname, '../web'),
        url: baseURL, reuseExistingServer: false, timeout: 120_000,
        env: { UIER_LOCAL: '1', UIER_EXTENSION_CLIENT_IDS: clientId, UIER_BASE_URL: baseURL,
            COSMOSDB_CONNECTION_STRING: '', COSMOSDB_ENDPOINT: '', AZURE_SCREENSHOTS_CONNECTION_STRING: '', AZURE_SCREENSHOTS_ENDPOINT: '', AZURE_SCREENSHOTS_CONTAINER: '', UIER_BOTID_DEV_BYPASS: '' }
    }
});
