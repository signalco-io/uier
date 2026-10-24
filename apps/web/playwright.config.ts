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
        // Tests run against the production build (`pnpm build` runs first via turbo).
        // Not `pnpm start`: that pins port 4004, the server has to listen on PORT.
        command: `pnpm exec next start -p ${PORT}`,
        // Outside CI a server already answering on PORT is reused instead of started
        url: baseURL,
        timeout: 120 * 1000,
        reuseExistingServer: !process.env.CI,
        env: {
            // Local runtime: BotID is skipped and the in-memory store is allowed (src/lib/comments/environment.ts)
            UIER_LOCAL: '1',
            // The comments API uses its in-memory store, never a database configured in .env.local
            COSMOSDB_CONNECTION_STRING: '',
            COSMOSDB_ENDPOINT: '',
            // Locally BotID treats every request as human unless this simulates another verdict
            UIER_BOTID_DEV_BYPASS: '',
            // Rewrite suggestions are never requested from the real API (the tests mock them)
            ANTHROPIC_API_KEY: '',
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
