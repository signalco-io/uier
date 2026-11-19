import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { backToComments, createProject, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';

// A suggested rewrite in the app's thread shows what it changes in the text it quoted, word by word: removed words
// struck through, added ones underlined, each with a "Removed:" or "Added:" for screen readers. A suggestion that
// keeps every word says so. The diff itself is `text-changes.api.spec.ts`; the toolbar's thread is `rewrite.spec.ts`.

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

const position = (text: string) => ({
    type: 'text', text, startSelector: 'main>p', startOffset: 0, startType: 'text', endSelector: 'main>p', endOffset: text.length, endType: 'text'
});

test('a suggested rewrite shows its changes, or that it changes no text', async ({ page, request }, testInfo) => {
    await signIn(page, uniqueEmail('rewrite-diff'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const post = async (original: string, text: string, structured: boolean) => {
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: `/${project}/pricing`, authorName: 'Reviewer', kind: 'rewrite', position: position(original), quotedText: original, text,
            ...(structured ? { proposal: { text: { original, proposed: text }, styles: {} } } : {})
        } });
        expect(response.status()).toBe(201);
    };
    await post('Plans start free for small teams.', 'Plans are free for small teams.', true);
    // The same text is saved without a proposal: there is nothing to change
    await post('Cancel any time.', 'Cancel any time.', false);
    await page.goto(`/app/projects/${project}`);

    let thread = await openComment(page, /Plans are free/);
    const changes = thread.locator('[data-text-changes=""]');
    await expect(changes).toHaveText('Plans Removed: start Added: are free for small teams.');
    await expect(changes.locator('del')).toHaveText(['Removed: start']);
    await expect(changes.locator('ins')).toHaveText(['Added: are']);
    // Not by colour alone: struck through and underlined
    expect(await changes.locator('del').evaluate(element => getComputedStyle(element).textDecorationLine)).toBe('line-through');
    expect(await changes.locator('ins').evaluate(element => getComputedStyle(element).textDecorationLine)).toBe('underline');
    // The literal original and proposed text are one click away
    await expect(thread.getByText('Original text', { exact: true })).toBeHidden();
    await thread.getByRole('button', { name: 'Exact text', exact: true }).click();
    await expect(thread.locator('dt:text-is("Original text") + dd')).toHaveText('Plans start free for small teams.');
    await expect(thread.locator('dt:text-is("Proposed text") + dd')).toHaveText('Plans are free for small teams.');
    await expectNoAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath('rewrite-diff.png') });

    if (testInfo.project.name.startsWith('Mobile')) await backToComments(page);
    thread = await openComment(page, /Cancel any time/);
    await expect(thread.getByText('No text changes. The suggestion matches the original text.', { exact: true })).toBeVisible();
    await expect(thread.locator('[data-text-changes=""]')).toHaveCount(0);
});
