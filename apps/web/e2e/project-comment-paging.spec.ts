import { test } from '@playwright/test';
import { projectPagingJourney } from './support/projectPaging';
import { startReviewedSite } from './support/reviewedSite';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

test('project columns page on scroll, virtualize, keep totals and load full details only when opened', async ({ page, request }, testInfo) => {
    await projectPagingJourney(page, request, testInfo, site.origin());
});
