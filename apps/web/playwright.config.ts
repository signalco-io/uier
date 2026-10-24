import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORT || 4004;
const baseURL = `http://127.0.0.1:${PORT}`;

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
            name: 'Desktop Chrome',
            use: {
                ...devices['Desktop Chrome'],
            },
        },
        {
            name: 'Mobile Chrome',
            use: {
                ...devices['Pixel 5'],
            },
        }
    ],
});
