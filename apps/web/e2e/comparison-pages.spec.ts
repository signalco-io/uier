import { expect, test } from '@playwright/test';
import { assertAccessibility } from './accessibility';

const proofFormats = 'Images, searchable PDFs, selected Figma frames, MP4, ProRes MOV and WebM video, uploaded EML, and interactive HTML from ZIP uploads.';

const pairs = [
    { slug: 'bugherd', name: 'BugHerd', advantage: 'Custom Kanban columns', checked: '2026-11-11', logo: '/compare/bugherd.png' },
    { slug: 'marker-io', name: 'Marker.io', advantage: 'Scheduled monitoring', checked: '2026-11-11', logo: '/compare/marker-io.svg' },
    { slug: 'usersnap', name: 'Usersnap', advantage: 'Surveys and voting boards', checked: '2026-11-11', logo: '/compare/usersnap.png' },
    { slug: 'pastel', name: 'Pastel', advantage: 'Multi-format canvases', checked: '2026-11-19', logo: '/compare/pastel.png' },
    { slug: 'userback', name: 'Userback', advantage: 'Feedback and full-session replay', checked: '2026-11-15', logo: '/compare/userback.png' },
    { slug: 'ruttl', name: 'ruttl', advantage: 'Custom Kanban lists', checked: '2026-11-15', logo: '/compare/ruttl.png' }
];

for (const pair of pairs) {
    test(`${pair.name} comparison exposes tradeoffs, source links and a contained table`, async ({ page }, testInfo) => {
        const response = await page.goto(`/compare/${pair.slug}`);
        expect(response?.status()).toBe(200);
        const main = page.getByRole('main');
        await expect(main.getByRole('heading', { level: 1, name: `uier vs ${pair.name}` })).toBeVisible();
        // The cover: uier's mark and the alternative's official logo, decorative, each with its name under it
        const cover = main.getByRole('list', { name: 'Compared tools', exact: true });
        await expect(cover.getByRole('listitem')).toHaveText(['uier', pair.name]);
        const logo = cover.locator(`img[src="${pair.logo}"][alt=""][aria-hidden="true"]`);
        await expect(logo).toHaveCount(1);
        await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
        await expect(main.getByRole('region', { name: 'Sources and scope' })).toContainText('Written by uier.');
        const table = main.getByRole('table');
        await expect(table.getByRole('columnheader')).toHaveText(['Workflow or feature', 'uier', pair.name]);
        await expect(table.getByRole('row').filter({ hasText: pair.advantage })).toHaveCount(1);
        const uierCell = (name: string) => table.getByRole('row').filter({ has: page.getByRole('rowheader', { name, exact: true }) }).getByRole('cell').first();
        const workflowCell = uierCell('Organizing the work');
        await expect(workflowCell).toContainText('Custom statuses and labels');
        await expect(workflowCell).toContainText('paged results');
        await expect(workflowCell).toContainText('at most 50');
        await expect(workflowCell).toContainText('No task due dates.');
        await expect(main).not.toContainText('no custom statuses');
        await expect(main).not.toContainText('1,000 recent');
        await expect(uierCell('Screen and audio recording')).toContainText('Available: Short screen recordings');
        for (const gap of ['Session replay before a report', 'Console and network capture', 'Surveys and request voting'])
            await expect(uierCell(gap)).toContainText('Not supported');
        const proofing = uierCell('File and design proofing');
        await expect(proofing).toContainText('Has limits: Six format families, enabled per project');
        for (const scope of [
            proofFormats,
            'PDF previews are sanitized. Authorized reviewers can download the original separately.',
            'Play and seek video in the browser. ProRes MOV is converted for playback.',
            'HTML runs on an isolated host.',
            'Email is upload-only. Inbound SMTP is unavailable.'
        ])
            await expect(proofing).toContainText(scope);
        await expect(uierCell('Reviewing a finished fix')).toContainText('Has limits: Named reviewer per thread');
        const approvals = uierCell('Approving a file version');
        await expect(approvals).toContainText('Available: Named reviewers per version');
        await expect(approvals).toContainText('Required reviewers each approve or request changes on the whole file version.');
        await expect(approvals).toContainText('Set an optional deadline for the round. Each new version starts with fresh decisions. Fix verification is a separate check on one thread.');
        await expect(main.getByRole('region', { name: 'What changes if you switch' })).toContainText(`There is no built-in importer for ${pair.name}`);
        await expect(main.getByRole('region', { name: 'Sources and scope' }).getByRole('link').first()).toHaveAttribute('href', /^https:\/\/github.com\//);
        const vendorSources = main.getByRole('region', { name: 'Sources and scope' }).getByRole('heading', { name: pair.name, exact: true }).locator('..');
        await expect(vendorSources.locator(':scope > p time')).toHaveAttribute('datetime', pair.checked);
        await expect(vendorSources.locator('li time').first()).toHaveAttribute('datetime', '2026-11-19');
        await expect(table.getByRole('link', { name: new RegExp(`^${pair.name.replace('.', '\\.')}: source`) }).first()).toHaveAttribute('href', /^https:\/\//);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(main.getByRole('link', { name: 'Create a project' })).toHaveAttribute('href', '/app');
        await expect(main.getByRole('link', { name: 'Compare all seven tools' })).toHaveAttribute('href', '/compare/website-feedback-tools');
        await expect(main.getByRole('link', { name: 'MCP setup guide' })).toHaveAttribute('href', '/guides/mcp');
        await expect(main.getByRole('link', { name: 'REST API reference' })).toHaveAttribute('href', '/developers/api');
        await main.getByRole('region', { name: 'Choose by the work you need to finish' }).screenshot({ path: testInfo.outputPath('workflow.png') });
    });
}

test('the full matrix retains caveats and source links behind keyboard disclosures', async ({ page }) => {
    await page.goto('/compare/website-feedback-tools');
    const main = page.getByRole('main');
    const table = main.getByRole('table');
    await expect(table.getByRole('columnheader')).toHaveText(['Workflow or feature', 'uier', 'BugHerd', 'Marker.io', 'Usersnap', 'Pastel', 'Userback', 'ruttl']);
    const row = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Screen and audio recording', exact: true }) });
    const usersnap = row.getByRole('cell').nth(3);
    await usersnap.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(usersnap.locator('details')).toHaveAttribute('open', '');
    await expect(usersnap).toContainText('Not supported in mobile web browsers or desktop Safari');
    await expect(usersnap.getByRole('link', { name: 'Usersnap: source for screen and audio recording' })).toHaveAttribute('href', 'https://help.usersnap.com/docs/feedback-with-a-screen-recording');
    const scrollingTable = main.getByRole('region', { name: 'Feature comparison table' });
    await scrollingTable.focus();
    await expect(scrollingTable).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(main).toContainText('Unknown is not a missing feature.');
    await expect(main).toContainText('uier supports short screen recordings with explicit permission.');
    await expect(main).toContainText('Built-in capture has no audio and ends on full-page navigation.');
    const overview = main.getByRole('region', { name: 'Where the workflows differ' });
    await expect(overview).toContainText(proofFormats);
    await expect(overview).toContainText('Enable the formats you need per project. Email is EML upload only.');
    await expect(overview).toContainText('Named reviewers approve a whole version. Fix verification checks one thread.');
    const proofing = table.getByRole('row', { name: /^File and design proofing/ }).getByRole('cell').first();
    await expect(proofing).toContainText('Six format families, enabled per project');
    await expect(proofing.getByText(proofFormats, { exact: false })).toBeHidden();
    await proofing.locator('summary').click();
    await expect(proofing.getByText(proofFormats, { exact: false })).toBeVisible();
    await expect(proofing.getByText('Inbound SMTP is unavailable.', { exact: false })).toBeVisible();
    await expect(main.getByRole('link', { name: 'REST API reference' })).toHaveAttribute('href', '/developers/api');
});

test('CSS and text details show the documented workflow and sources for each tool', async ({ page }) => {
    await page.goto('/compare/website-feedback-tools');
    const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Demonstrating CSS and text changes', exact: true }) });
    const sources = page.getByRole('region', { name: 'Sources and scope' });
    const claims = [
        ['Available: On-page text and style previews', /one eligible element.*Original and Proposed.*exact values.*source/, '/features/pinned-comments#preview-a-change'],
        ['Has limits: Text replacement in a pinned task', /pinned task saves both the original and the replacement.*previews.*unverified/, 'https://bugherd.com/feature/suggest-text-edits'],
        ['Not verified: On-page edits not verified', /annotating a captured screenshot.*previews are unverified/, 'https://marker.io/website-design-feedback'],
        ['Not verified: On-page edits not verified', /highlight, pen, arrow, comment and hide.*previews are unverified/, 'https://help.usersnap.com/docs/feedback-with-a-screenshot'],
        ['Has limits: Text previews in a website canvas', /Before and After on the canvas.*copy the edited text.*CSS previews are unverified/, 'https://help.usepastel.com/en/articles/5063677-editing-text-in-a-canvas'],
        ['Not verified: On-page edits not verified', /boxes, arrows, text and pinned comments.*previews are unverified/, 'https://userback.io/feature/screen-annotation/'],
        ['Available: CSS and text in website projects', /edit mode is unavailable in web app projects/, 'https://www.ruttl.com/blog/marker-io-alternatives-best-web-annotation-bug-reporting-tools']
    ] as const;
    for (const [index, [label, detail, url]] of claims.entries()) {
        const cell = row.getByRole('cell').nth(index);
        await expect(cell).toContainText(label);
        await cell.locator('summary').click();
        await expect(cell.locator('details')).toHaveAttribute('open', '');
        await expect(cell.locator('details p').first()).toHaveText(detail);
        await expect(cell.locator(`a[href="${url}"]`)).toBeVisible();
        await expect(sources.locator('li').filter({ has: page.locator(`a[href="${url}"]`) }).locator('time')).toHaveAttribute('datetime', '2026-11-19');
    }
    const faq = 'https://www.ruttl.com/features/review-web-applications';
    await expect(row.getByRole('link', { name: 'Web application FAQ' })).toHaveAttribute('href', faq);
    await expect(sources.locator('li').filter({ has: page.locator(`a[href="${faq}"]`) }).locator('time')).toHaveAttribute('datetime', '2026-11-19');
});

test('the hub links every comparison and is linked from the public site', async ({ page }, testInfo) => {
    await page.goto('/compare');
    const main = page.getByRole('main');
    await expect(main).not.toContainText('Written by uier.');
    const workflows = main.getByRole('region', { name: 'Start with the job' });
    await expect(workflows).toContainText('Preview proposed text and style changes on the page');
    await expect(workflows).toContainText(proofFormats);
    await expect(workflows).toContainText('Enable formats per project and request approval on a specific version.');
    await expect(main.getByRole('link', { name: 'REST API reference' })).toHaveAttribute('href', '/developers/api');
    await expect(main.getByRole('link', { name: 'approval rounds', exact: true })).toHaveAttribute('href', /\/proof-api\.md#version-approvals-and-review-record$/);
    const preview = main.getByRole('link', { name: 'on-page previews' });
    await expect(preview).toHaveAttribute('href', '/features/pinned-comments#preview-a-change');
    await preview.click();
    const help = page.getByRole('region', { name: 'Preview text and style changes' });
    await expect(help).toBeVisible();
    await expect(help).toContainText('Suggest a change');
    await expect(help).toContainText('implement the change in the site’s source');
    await page.goto('/compare');
    for (const pair of pairs)
        await expect(main.getByRole('link', { name: `uier vs ${pair.name}`, exact: true })).toHaveAttribute('href', `/compare/${pair.slug}`);
    await main.getByRole('region', { name: 'Start with the job' }).screenshot({ path: testInfo.outputPath('workflows.png') });
    await main.getByRole('link', { name: 'Compare all seven tools' }).click();
    await expect(page).toHaveURL(/\/compare\/website-feedback-tools$/);
    await page.goto('/');
    await expect(page.getByRole('main').getByRole('link', { name: 'Compare website feedback tools' })).toHaveAttribute('href', '/compare');
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Compare website feedback tools' })).toHaveAttribute('href', '/compare');
});

test('the Pastel tradeoffs cover Figma revisions and separate approval decisions', async ({ page }) => {
    await page.goto('/compare/pastel');
    const tradeoffs = page.getByRole('region', { name: 'What changes if you switch' });
    await expect(tradeoffs).toContainText('Resync a Figma frame under the same review link, even after a rename. Existing threads keep their original version and location.');
    await expect(tradeoffs).toContainText('Named reviewers decide on the whole version in a separate approval round.');
    await expect(tradeoffs).toContainText('An agent can send HTML prototypes to Pastel through its CLI or MCP, then reuse the canvas link for revisions.');
    await expect(tradeoffs).toContainText('Search text in sanitized PDF previews. Open interactive HTML ZIP uploads on an isolated host. Email review accepts EML uploads.');
    await expect(tradeoffs).toContainText('Share an EML upload with a client');
});

test('new comparisons retain distinct examples, current billing caveats and shared MCP limits', async ({ page }) => {
    await page.goto('/compare/userback');
    let main = page.getByRole('main');
    await expect(main.getByRole('region', { name: 'A checkout report needs reproduction evidence' })).toContainText('changing the collection time clears the basket');
    await expect(main.getByRole('region', { name: 'Setup, integrations and cost' })).toContainText('seven days');
    await expect(main.getByRole('region', { name: 'Sources and scope' })).toContainText('does not automatically fix code');
    await expect(main.getByRole('link', { name: 'manual acceptance review' })).toHaveAttribute('href', '/use-cases/user-acceptance-testing');

    await page.goto('/compare/ruttl');
    main = page.getByRole('main');
    const layout = main.getByRole('region', { name: 'A client wants to show a layout change' });
    await expect(layout).toContainText('separate PDF menu');
    await expect(layout).toContainText('choose Suggest a change');
    await expect(layout).toContainText('side padding');
    await expect(layout).toContainText('Once PDF review is enabled, upload the menu and collect feedback in the file viewer.');
    await expect(main.getByRole('region', { name: 'What changes if you switch' })).toContainText('single element');
    await expect(main.getByRole('region', { name: 'Setup, integrations and cost' })).toContainText('Cards and the detailed table differ');
    const checks = main.getByRole('table').getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Accessibility and SEO checks', exact: true }) }).getByRole('cell').last();
    await expect(checks).toContainText('Not verified');
    await expect(checks).toContainText('coming soon');
    await expect(main.getByRole('link', { name: 'client website feedback' })).toHaveAttribute('href', '/use-cases/client-feedback');
});

for (const path of ['/compare', '/compare/website-feedback-tools', ...pairs.map(pair => `/compare/${pair.slug}`)])
    test(`${path} is accessible`, ({ page }) => assertAccessibility(page, path));
