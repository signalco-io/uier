import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT || 4004);
const baseURL = `http://127.0.0.1:${PORT}`;

// Rewrite suggestions call a stand-in for the Anthropic API (e2e/support/anthropicStub.ts), on a
// port derived from PORT so parallel runs don't collide, with a fake key: no test needs a real one
const anthropicStubPort = PORT + 1000;
const anthropicStubUrl = `http://127.0.0.1:${anthropicStubPort}`;
const anthropicStubApiKey = 'e2e-stub-key';

// Comments API tests (no browser) run once, not per device
const apiTests = /\.api\.spec\.ts$/;

export default defineConfig({
    retries: 2,
    timeout: 30 * 1000,
    testDir: join(dirname(fileURLToPath(import.meta.url)), 'e2e'),
    outputDir: 'test-results/',
    webServer: [
        {
            command: 'node e2e/support/anthropicStub.ts',
            url: anthropicStubUrl,
            timeout: 30 * 1000,
            reuseExistingServer: false,
            env: {
                PORT: String(anthropicStubPort),
                ANTHROPIC_STUB_API_KEY: anthropicStubApiKey,
            },
        },
        {
            // Tests run against the production build (`pnpm build` runs first via turbo).
            // Not `pnpm start`: that pins port 4004, the server has to listen on PORT.
            command: `pnpm exec next start -p ${PORT}`,
            url: baseURL,
            timeout: 120 * 1000,
            // Never reused: a server already on PORT (`pnpm dev`, an older build, another worktree's
            // run) would be tested instead, maybe with a real Anthropic API key. The run fails; set PORT.
            reuseExistingServer: false,
            env: {
                // Local runtime: BotID is skipped and the in-memory store is allowed (src/lib/comments/environment.ts)
                UIER_LOCAL: '1',
                // The comments API uses its in-memory store, never a database configured in .env.local
                COSMOSDB_CONNECTION_STRING: '',
                COSMOSDB_ENDPOINT: '',
                // Locally BotID treats every request as human unless this simulates another verdict
                UIER_BOTID_DEV_BYPASS: '',
                // Rewrite suggestions go to the stub above, never to the real API
                ANTHROPIC_API_KEY: anthropicStubApiKey,
                ANTHROPIC_BASE_URL: anthropicStubUrl,
            },
        },
    ],
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
        },
        // Portable launch flows complement the older Chromium-specific touch tests.
        ...(process.env.PLAYWRIGHT_CROSS_BROWSER ? [
            { name: 'Desktop Firefox', testMatch: /launch\.spec\.ts$/, use: { ...devices['Desktop Firefox'] } },
            { name: 'Desktop WebKit', testMatch: /launch\.spec\.ts$/, use: { ...devices['Desktop Safari'] } },
            { name: 'Mobile WebKit', testMatch: /launch\.spec\.ts$/, use: { ...devices['iPhone 13'] } },
        ] : []),
    ],
});
