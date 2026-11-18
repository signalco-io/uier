import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
import base from './playwright.config';

// Loading-state capture (e2e/loading-states/*.capture.ts): not a test suite. It holds every app route, the toolbar and
// the extension's pages in their loading states and saves a screenshot of each (desktop and phone) beside the loaded
// page. App routes are held with Next's instant-navigation testing API, so the build needs it:
// `UIER_INSTANT_TEST=1 pnpm build` (repository root), then from apps/web
// `PORT=4604 pnpm exec playwright test --config=playwright.capture.config.ts` and
// `node e2e/loading-states/gallery.mjs`. Captures and the gallery go to playwright-report/loading-states (ignored by
// git; CAPTURE_DIR changes it). Rebuild without the flag afterwards: never deploy or test a testing-API build.
const artifact = JSON.parse(readFileSync(new URL('./.next/required-server-files.json', import.meta.url), 'utf8')) as {
    config: { experimental: { exposeTestingApiInProductionBuild?: boolean } };
};
if (artifact.config.experimental.exposeTestingApiInProductionBuild !== true)
    throw new Error('Loading-state capture requires a fresh UIER_INSTANT_TEST=1 pnpm build.');

export default defineConfig({
    ...base,
    testMatch: /loading-states\/.*\.capture\.ts$/,
    testIgnore: [],
    retries: 0,
    workers: 1,
    fullyParallel: false,
    globalTimeout: 0,
    timeout: 20 * 60 * 1000,
    reporter: [['list']],
    outputDir: 'test-results/loading-states/',
    webServer: (Array.isArray(base.webServer) ? base.webServer : []).map(server => ({
        ...server,
        env: { ...server.env, UIER_INSTANT_TEST: '1' },
    })),
    use: { ...base.use, trace: 'off', navigationTimeout: 20_000, actionTimeout: 15_000 },
    projects: [
        { name: 'desktop', grep: undefined, testIgnore: [], use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
        { name: 'mobile', grep: undefined, testIgnore: [], use: { ...devices['Pixel 5'], deviceScaleFactor: 2 } },
    ],
});
