import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORT || 4004;
const baseURL = `http://127.0.0.1:${PORT}`;

// Comments API tests (no browser) run once, not per device
const apiTests = /\.api\.spec\.ts$/;

export default defineConfig({
    retries: 2,
    timeout: 30 * 1000,
    testDir: join(dirname(fileURLToPath(import.meta.url)), 'e2e'),
    outputDir: 'test-results/',
    webServer: {
        // Tests run against the production build (`pnpm build` runs first via turbo)
        command: 'pnpm start',
        url: baseURL,
        timeout: 120 * 1000,
        reuseExistingServer: !process.env.CI,
        env: {
            // The comments API uses its in-memory store, never a database configured in .env.local
            COSMOSDB_CONNECTION_STRING: '',
            // Not on Vercel, BotID treats every request as human unless this simulates another verdict
            UIER_BOTID_DEV_BYPASS: '',
        },
    },
    use: {
        headless: true,
        viewport: { width: 1280, height: 720 },
        baseURL,
        trace: 'on-first-retry',
        video: 'off'
    },
    projects: [
        {
            name: 'API',
            testMatch: apiTests,
        },
        {
            name: 'Desktop Chrome',
            testIgnore: apiTests,
            use: {
                ...devices['Desktop Chrome'],
            },
        },
        {
            name: 'Mobile Chrome',
            testIgnore: apiTests,
            use: {
                ...devices['Pixel 5'],
            },
        }
    ],
});
