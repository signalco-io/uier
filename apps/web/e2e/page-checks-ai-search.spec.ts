import { expect, test, type Page, type Request } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished, toolbar } from './support/toolbar';

// The SEO panel's AI search section (packages/toolbar/docs/page-checks-ai-search.md) on a project's
// site on another origin with the install guide's CSP: the page's main content as Markdown, what the
// text leaves out, its citable facts, and AI suggestions that send the page's text only when asked
// (the e2e server's Anthropic API is the stand-in in support/anthropicStub.ts).

test.use({ actionTimeout: 15_000 });

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

const origin = () => site.origin('fixture-ai-search');

/** The fixture's article (support/fixtures/aiSearch.ts) as Markdown */
const articleMarkdown = [
    '# Reviewing websites',
    'Published 4 March 2026 by Ada Lovelace.',
    'A **short** guide with [a source](https://example.org/source).',
    '## Steps',
    '- Open the page\n- Leave a comment\n  - On an element',
    '| Plan | Price |\n| --- | --- |\n| Free | 0 |',
    '> Say it on the page.',
    '```\nnpm install\n```',
    '![Plans chart](/chart.png)',
    '**More plans**'
].join('\n\n');

/** A member reviews the fixture's page through the app's review link, and opens the SEO panel */
async function openSeoPanel(page: Page, label: string, query = '') {
    await signIn(page, uniqueEmail(label));
    const project = await createProject(page, { urls: [origin()] });
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${origin()}/${project}/guide${query}`)}`);
    await expect(toolbar(page)).toBeVisible();
    await toolbar(page).getByRole('button', { name: /^SEO/ }).click();
    const panel = page.getByRole('complementary', { name: 'SEO' });
    await expect(panel.locator('[data-uier-section="aiSearch"]')).toHaveAttribute('data-uier-section-status', 'done', { timeout: 20_000 });
    return { project, panel };
}

function nextCreate(page: Page, project: string) {
    return page.waitForRequest((request: Request) => request.method() === 'POST' && new URL(request.url()).pathname === `/api/review/${project}/comments`);
}

test('the AI search section shows the main content as Markdown, what it leaves out and the citable facts, and asks for suggestions only when pressed', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(120_000);
    const suggestionRequests: Request[] = [];
    page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/page-suggestions')) suggestionRequests.push(request); });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: origin() });
    const { project, panel } = await openSeoPanel(page, 'ai-search');
    const section = panel.locator('[data-uier-section="aiSearch"]');
    const check = (id: string) => panel.locator(`[data-uier-check="${id}"]`);

    // What an AI reads: the main landmark, as rendered in this browser
    await expect(section.getByRole('heading', { name: 'AI search' })).toBeVisible();
    await expect(section).toContainText('As rendered in this browser');
    await expect(check('ai-content')).toHaveAttribute('data-uier-check-state', 'pass');
    await expect(check('ai-content')).toContainText('The main landmark');
    // A short page: its words, headings and an estimate of tokens are a note
    await expect(check('ai-text')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(check('ai-text')).toContainText(/\d+ words, 2 headings/);
    await expect(check('ai-text')).toContainText(/about \d+ tokens/);
    await expect(check('ai-text')).toContainText('Very little text in the main content. From the page as rendered in this browser.');
    await expect(check('ai-left-out')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(check('ai-left-out')).toContainText('1 image without alt text, 1 frame and 2 hidden blocks of text');

    // The Markdown, folded: exact, without the site's navigation and footer, the query of a link or the toolbar
    const preview = section.getByRole('textbox', { name: 'Main content as Markdown' });
    await expect(preview).toHaveCount(0);
    await section.getByRole('button', { name: 'Markdown', exact: true }).click();
    await expect(section.getByRole('button', { name: 'Markdown', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(preview).toHaveValue(articleMarkdown);

    // Copy as Markdown
    await section.getByRole('button', { name: 'Copy as Markdown' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(articleMarkdown);

    // Citable facts: an article, with an author, a publisher and a source, and a shown date its structured data disagrees with
    const facts = panel.locator('[data-uier-section="aiSearch-facts"]');
    await expect(facts.getByRole('heading', { name: 'Citable facts' })).toBeVisible();
    await expect(check('ai-article')).toContainText('Article');
    await expect(check('ai-article')).toContainText('Its og:type is article.');
    await expect(check('ai-author')).toHaveAttribute('data-uier-check-state', 'pass');
    await expect(check('ai-author')).toContainText('Ada Lovelace');
    await expect(check('ai-publisher')).toHaveAttribute('data-uier-check-state', 'pass');
    await expect(check('ai-publisher')).toContainText('Example Reviews');
    await expect(check('ai-sources')).toHaveAttribute('data-uier-check-state', 'pass');
    await expect(check('ai-sources')).toContainText('example.org');
    await expect(check('ai-sources')).toContainText('1 link to another site in the main content.');
    await expect(check('ai-dates')).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(check('ai-dates')).toContainText('Shown 2026-03-04, structured data 2026-05-01');
    await expect(check('ai-dates')).toContainText('The date the page shows and the date in its structured data are more than a day apart.');

    // The disagreement is a comment on the shown date, with both values
    const created = nextCreate(page, project);
    await check('ai-dates').getByRole('button', { name: 'Comment' }).click();
    const body = (await created).postDataJSON();
    expect(body.text).toBe('SEO: The date the page shows and the date in its structured data are more than a day apart.\nShown: `4 March 2026 (2026-03-04)`\nStructured data: `2026-05-01`');
    expect(body.check).toEqual({ type: 'seo', id: 'ai-dates' });
    expect(body.position).toMatchObject({ type: 'point' });
    await expect(check('ai-dates')).toContainText(/Comment posted/);

    // Nothing has left the browser for suggestions yet
    const suggestions = section.locator('[data-uier-ai-suggestions]');
    await expect(suggestions).toContainText('Sends this page’s main text to uier.');
    expect(suggestionRequests).toHaveLength(0);

    // A title: the page's text, title and description go to the project's route; three suggestions as plain text
    const titleRequest = page.waitForRequest(request => new URL(request.url()).pathname === `/api/review/${project}/page-suggestions`);
    await suggestions.getByRole('button', { name: 'Suggest a title' }).click();
    expect((await titleRequest).postDataJSON()).toEqual({
        kind: 'title', text: articleMarkdown, title: 'Reviewing websites with comments',
        description: 'A short guide to reviewing a live website by leaving comments pinned to its elements.'
    });
    const titles = suggestions.getByRole('list', { name: 'Suggested titles' });
    await expect(titles.getByRole('listitem')).toHaveText([
        /^Plans and pricing for website reviews/, /^Compare plans that include the toolbar/, /^Pricing: every plan includes the toolbar/
    ]);

    // Copy one, and post another as a comment about the page that names the title check
    await titles.getByRole('listitem').nth(1).getByRole('button', { name: 'Copy' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Compare plans that include the toolbar');
    const posted = nextCreate(page, project);
    await titles.getByRole('listitem').first().getByRole('button', { name: 'Comment' }).click();
    const comment = (await posted).postDataJSON();
    expect(comment.text).toBe('SEO: Suggested title for this page, from AI suggestions.\nSuggested title: `Plans and pricing for website reviews`\nCurrent title: `Reviewing websites with comments`');
    expect(comment.check).toEqual({ type: 'seo', id: 'title' });
    expect(comment.position).toEqual({ type: 'page' });
    await expect(titles.getByRole('listitem').first()).toContainText(/sent|posted/);
    // Like the title check's own issue, one open thread a page: the other titles say so, with Show
    await expect(titles.getByRole('listitem').nth(2)).toContainText(/Reported as #\d+/);
    await expect(titles.getByRole('listitem').nth(2).getByRole('button', { name: 'Show' })).toBeVisible();

    // The questions it answers: copy only. The button keeps the focus while it asks (busy, not disabled)
    const questionsButton = suggestions.getByRole('button', { name: 'Questions this page answers' });
    await questionsButton.click();
    const questions = suggestions.getByRole('list', { name: 'Questions this page answers' });
    await expect(questions.getByRole('listitem')).toHaveCount(3);
    await expect(questionsButton).toBeFocused();
    await expect(questionsButton).not.toHaveAttribute('aria-busy', 'true');
    await expect(questions.getByRole('button', { name: 'Comment' })).toHaveCount(0);
    expect(suggestionRequests).toHaveLength(2);

    await animationsFinished(panel);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });

    // Kept while the panel is closed, without asking again
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await toolbar(page).getByRole('button', { name: /^SEO/ }).click();
    await expect(panel.locator('[data-uier-ai-suggestions]').getByRole('list', { name: 'Suggested titles' }).getByRole('listitem').first()).toContainText(/sent|posted/);
    expect(suggestionRequests).toHaveLength(2);
});

test('on a phone the section fits the panel and its controls are large enough to tap', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.use.isMobile, 'Phone layout');
    test.setTimeout(90_000);
    await signIn(page, uniqueEmail('ai-search-phone'));
    const project = await createProject(page, { urls: [origin()] });
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${origin()}/${project}/guide`)}`);
    const pill = toolbar(page);
    await pill.getByRole('button', { name: 'Options', exact: true }).tap();
    await page.getByRole('dialog', { name: 'Options' }).getByRole('button', { name: /^SEO/ }).tap();
    const panel = page.getByRole('complementary', { name: 'SEO' });
    const suggestions = panel.locator('[data-uier-ai-suggestions]');
    await expect(suggestions).toBeVisible({ timeout: 20_000 });
    await suggestions.getByRole('button', { name: 'Suggest a meta description' }).tap();
    const list = suggestions.getByRole('list', { name: 'Suggested meta descriptions' });
    await expect(list.getByRole('listitem')).toHaveCount(3);
    const panelBox = (await panel.boundingBox())!;
    for (const control of [
        suggestions.getByRole('button', { name: 'Suggest a title' }),
        panel.getByRole('button', { name: 'Copy as Markdown' }),
        list.getByRole('listitem').first().getByRole('button', { name: 'Copy' }),
        list.getByRole('listitem').first().getByRole('button', { name: 'Comment' })
    ]) {
        const box = (await control.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a page without a main landmark is read from its body without the site\'s chrome, and its facts are notes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(90_000);
    const { panel } = await openSeoPanel(page, 'ai-search-body', '?no-main');
    const section = panel.locator('[data-uier-section="aiSearch"]');
    const check = (id: string) => panel.locator(`[data-uier-check="${id}"]`);

    await expect(check('ai-content')).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(check('ai-content')).toContainText('No main landmark. Read from the body without its chrome.');
    await expect(check('ai-content')).toContainText('The body, without navigation, header, footer, aside and forms');
    await expect(check('ai-left-out')).toHaveAttribute('data-uier-check-state', 'pass');
    await section.getByRole('button', { name: 'Markdown', exact: true }).click();
    await expect(section.getByRole('textbox', { name: 'Main content as Markdown' })).toHaveValue('# Plans\n\nEvery plan includes the toolbar.');

    // Not an article: every fact is a note, a missing one too
    await expect(check('ai-article')).toContainText('Not an article');
    const facts = panel.locator('[data-uier-section="aiSearch-facts"]');
    await expect(facts.locator('[data-uier-check]')).toHaveCount(5);
    await expect(facts.locator('[data-uier-check-state="none"]')).toHaveCount(5);
    await expect(check('ai-author')).toContainText('No author named in the page or its structured data.');
    await expect(check('ai-dates')).toContainText('No published or modified date in the page or its structured data.');
    await expect(check('ai-author').getByRole('button', { name: 'Comment' })).toHaveCount(0);
});
