import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
import base from './playwright.config';

const artifact = JSON.parse(readFileSync(new URL('./.next/required-server-files.json', import.meta.url), 'utf8')) as {
    config: { experimental: { exposeTestingApiInProductionBuild?: boolean } };
};
if (artifact.config.experimental.exposeTestingApiInProductionBuild !== true)
    throw new Error('Instant navigation tests require a fresh UIER_INSTANT_TEST=1 pnpm build.');

export default defineConfig({
    ...base,
    testMatch: /(?:instant-nav|partial-prefetching(?:-optimizer)?)\.spec\.ts$/,
    testIgnore: [],
    retries: 0,
    workers: 2,
    globalTimeout: 0,
    // next start also loads next.config.ts; match the measured artifact's opt-in.
    webServer: (Array.isArray(base.webServer) ? base.webServer : []).map(server => ({
        ...server,
        env: { ...server.env, UIER_INSTANT_TEST: '1' },
    })),
    projects: [
        { name: 'Desktop Chrome', grep: undefined, testIgnore: [], use: { ...devices['Desktop Chrome'] } },
        { name: 'Mobile Chrome', grep: undefined, testIgnore: [], use: { ...devices['Pixel 5'] } },
        { name: 'Tablet Chrome', grep: undefined, testIgnore: [], use: { ...devices['iPad Mini'], browserName: 'chromium' } },
    ],
});
