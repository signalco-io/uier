import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { generateKeyPairSync } from 'node:crypto';

const PORT = Number(process.env.PORT || 4004);
const baseURL = `http://127.0.0.1:${PORT}`;

// Rewrite suggestions call a stand-in for the Anthropic API (e2e/support/anthropicStub.ts), on a
// port derived from PORT so parallel runs don't collide, with a fake key: no test needs a real one
const anthropicStubPort = PORT + 1000;
const anthropicStubUrl = `http://127.0.0.1:${anthropicStubPort}`;
const anthropicStubApiKey = 'e2e-stub-key';
const notionStubUrl = `http://127.0.0.1:${PORT + 2000}`;
const githubStubUrl = `http://127.0.0.1:${PORT + 3000}`;
const linearStubUrl = `http://127.0.0.1:${PORT + 4000}`;
const slackStubUrl = `http://127.0.0.1:${PORT + 5000}`;
const testTokenKey = Buffer.alloc(32, 93).toString('base64');
// Generated only for this local test process; never a registered GitHub App private key.
const githubPrivateKey = generateKeyPairSync('rsa', { modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;

// Comments API tests (no browser) run once, not per device
const apiTests = /\.api\.spec\.ts$/;

export default defineConfig({
    retries: 2,
    timeout: 30 * 1000,
    testDir: join(dirname(fileURLToPath(import.meta.url)), 'e2e'),
    outputDir: 'test-results/',
    webServer: [
        { command: 'node e2e/support/notionStub.ts', url: notionStubUrl, timeout: 30_000, reuseExistingServer: false,
            env: { PORT: String(PORT + 2000), UIER_NOTION_STUB_APP_BASE_URL: baseURL } },
        { command: 'node e2e/support/githubStub.ts', url: githubStubUrl, timeout: 30_000, reuseExistingServer: false,
            env: { PORT: String(PORT + 3000), UIER_GITHUB_PRIVATE_KEY: githubPrivateKey, UIER_GITHUB_STUB_APP_BASE_URL: baseURL } },
        { command: 'node e2e/support/linearStub.ts', url: linearStubUrl, timeout: 30_000, reuseExistingServer: false,
            env: { PORT: String(PORT + 4000) } },
        { command: 'node e2e/support/slackStub.ts', url: slackStubUrl, timeout: 30_000, reuseExistingServer: false,
            env: { PORT: String(PORT + 5000) } },
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
                UIER_EMAIL_REPORT_SECRET: 'e2e-email-report-secret',
                UIER_EMAIL_REPORT_SUBSCRIPTION: 'uier-email-delivery',
                UIER_EMAIL_REPORT_TOPIC: '/subscriptions/test/resourceGroups/test/providers/Microsoft.Communication/communicationServices/test',
                // Fictional local-only staff identities; never inherit a real staff allowlist.
                UIER_STAFF_EMAILS: 'e2e-public-staff-desktop@example.test,e2e-public-staff-mobile@example.test,e2e-users-staff-desktop@example.test,e2e-users-staff-mobile@example.test',
                // The comments API uses its in-memory store, never a database configured in .env.local
                COSMOSDB_CONNECTION_STRING: '',
                COSMOSDB_ENDPOINT: '',
                // Locally BotID treats every request as human unless this simulates another verdict
                UIER_BOTID_DEV_BYPASS: '',
                // Rewrite suggestions go to the stub above, never to the real API
                ANTHROPIC_API_KEY: anthropicStubApiKey,
                ANTHROPIC_BASE_URL: anthropicStubUrl,
                NOTION_CLIENT_ID: 'notion-test-client', NOTION_CLIENT_SECRET: 'notion-test-secret', NOTION_TOKEN_KEY: testTokenKey,
                NOTION_API_BASE_URL: notionStubUrl, NOTION_OAUTH_AUTHORIZE_URL: `${notionStubUrl}/v1/oauth/authorize`, NOTION_REQUEST_INTERVAL_MS: '0',
                UIER_GITHUB_APP_ID: '999', UIER_GITHUB_APP_SLUG: 'uier-test', UIER_GITHUB_CLIENT_ID: 'Iv1.uier-test',
                UIER_GITHUB_CLIENT_SECRET: 'test-client-secret', UIER_GITHUB_SETUP_KEY: testTokenKey,
                UIER_GITHUB_WEBHOOK_SECRET: 'test-webhook-secret', UIER_GITHUB_PRIVATE_KEY: githubPrivateKey,
                UIER_GITHUB_API_BASE_URL: githubStubUrl, UIER_GITHUB_OAUTH_BASE_URL: githubStubUrl,
                LINEAR_CLIENT_ID: 'linear-test-client', LINEAR_CLIENT_SECRET: 'linear-test-secret', LINEAR_TOKEN_KEY: testTokenKey,
                LINEAR_API_BASE_URL: `${linearStubUrl}/graphql`, LINEAR_OAUTH_AUTHORIZE_URL: `${linearStubUrl}/oauth/authorize`,
                LINEAR_OAUTH_TOKEN_URL: `${linearStubUrl}/oauth/token`, LINEAR_OAUTH_REVOKE_URL: `${linearStubUrl}/oauth/revoke`,
                SLACK_CLIENT_ID: 'slack-test-client', SLACK_CLIENT_SECRET: 'slack-test-secret', SLACK_APP_ID: 'ATESTAPP', SLACK_TOKEN_KEY: testTokenKey,
                SLACK_API_BASE_URL: `${slackStubUrl}/api/`, SLACK_OAUTH_AUTHORIZE_URL: `${slackStubUrl}/oauth/authorize`,
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
