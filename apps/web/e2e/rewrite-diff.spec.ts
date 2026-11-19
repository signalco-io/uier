import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { backToComments, createProject, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';

// A suggested rewrite in the app's thread shows what it changes in the text it quoted, word by word: removed words
// struck through, added ones underlined, each with a "Removed:" or "Added:" for screen readers. A suggestion that
// keeps every word says so, and one that changes only spacing or line breaks says that. The diff itself is
// `text-changes.api.spec.ts`; the toolbar's thread is `rewrite.spec.ts`.

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
    /** `quote`: what the toolbar saves, the selection trimmed and cut to 1000 characters; older rewrites have none */
    const post = async (original: string, text: string, structured: boolean, quote: string | undefined = original) => {
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: `/${project}/pricing`, authorName: 'Reviewer', kind: 'rewrite', position: position(original), text,
            ...(quote === undefined ? {} : { quotedText: quote }),
            ...(structured ? { proposal: { text: { original, proposed: text }, styles: {} } } : {})
        } });
        expect(response.status()).toBe(201);
    };
    await post('Plans start free for small teams.', 'Plans are free for small teams.', true);
    // The same text is saved without a proposal: there is nothing to change
    await post('Cancel any time.', 'Cancel any time.', false);
    // Keeping the first 1000 characters of a longer selection removes its tail, though they match the cut quote
    const long = Array.from({ length: 150 }, (_, index) => `Sentence ${index}.`).join(' ');
    await post(long, long.slice(0, 1000).trimEnd(), false, long.slice(0, 1000));
    // An older rewrite with a saved selection and no quote
    await post('Book a table today.', 'Book a table now.', false, undefined);
    // A line break turned into a space: the page shows it, so it is not "no change"
    await post('Open daily\nfrom noon.', 'Open daily from noon.', false);
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

    if (testInfo.project.name.startsWith('Mobile')) await backToComments(page);
    thread = await openComment(page, /Sentence 0\./);
    await expect(thread.locator('[data-text-changes=""] del')).toHaveText([/^\s*Removed:\s+77\. Sentence 78\..* Sentence 149\.$/]);
    await expect(thread.locator('[data-text-changes=""] ins')).toHaveCount(0);

    if (testInfo.project.name.startsWith('Mobile')) await backToComments(page);
    thread = await openComment(page, /Book a table now/);
    await expect(thread.locator('[data-text-changes=""] del')).toHaveText(['Removed: today']);
    await expect(thread.locator('[data-text-changes=""] ins')).toHaveText(['Added: now']);

    if (testInfo.project.name.startsWith('Mobile')) await backToComments(page);
    thread = await openComment(page, /Open daily from noon/);
    await expect(thread.getByText('Only spacing changes. The words match the original text.', { exact: true })).toBeVisible();
});
