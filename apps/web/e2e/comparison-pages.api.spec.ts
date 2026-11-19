import { expect, test } from '@playwright/test';

test('unknown comparison slugs return a real 404', async ({ request }) => {
    for (const path of ['/compare/unknown', '/compare/bugherd-alternative', '/compare/pastel/unknown'])
        expect((await request.get(path)).status(), path).toBe(404);
});

test('both comparison tables document Pastel HTML uploads and the agent workflow', async ({ request }) => {
    for (const path of ['/compare/pastel', '/compare/website-feedback-tools']) {
        const response = await request.get(path, { headers: { 'User-Agent': 'Googlebot' } });
        expect(response.status(), path).toBe(200);
        const html = await response.text();
        expect(html).toContain('HTML prototype as a single file, folder or ZIP');
        expect(html).toContain('same canvas link across revisions');
        expect(html).toContain('upload an HTML revision');
        expect(html).toContain('href="https://help.usepastel.com/en/articles/17629923-get-feedback-on-html-files-upload-directly-from-your-ai-agent"');
        expect(html).toContain('href="https://help.usepastel.com/en/articles/16399713-connect-your-ai-agent-to-pastel-mcp-server"');
    }
});

test('comparison HTML links the scoped file proof and approval claims', async ({ request }) => {
    const docs = 'https://github.com/signalco-io/uier/blob/main/apps/web/docs';
    for (const path of ['/compare/pastel', '/compare/website-feedback-tools']) {
        const response = await request.get(path, { headers: { 'User-Agent': 'Googlebot' } });
        expect(response.status(), path).toBe(200);
        const html = await response.text();
        expect(html).toContain('Project-enabled file review');
        expect(html).toContain('Review images, selected Figma frames, MP4 videos and EML uploads. Formats are enabled per project.');
        expect(html).toContain('Reviewing a finished fix');
        expect(html).toContain('Approving a file version');
        expect(html).toContain('Set a deadline for an approval round.');
        expect(html).toContain('No task due dates.');
        expect(html).toContain(`href="${docs}/proof-api.md#format-settings-and-processing"`);
        expect(html).toContain(`href="${docs}/proof-api.md#version-approvals-and-review-record"`);
        expect(html).toContain(`href="${docs}/proof-viewer.md"`);
        expect(html).not.toContain('No file proofing');
    }
});

test('comparison caveats and official evidence are present in crawler HTML', async ({ request }) => {
    const response = await request.get('/compare/website-feedback-tools', { headers: { 'User-Agent': 'Googlebot' } });
    expect(response.status()).toBe(200);
    const html = await response.text();
    for (const text of ['Not supported', 'Not verified', 'Selected paid plans', 'desktop Safari', 'Asset-version approval', 'Written by uier.'])
        expect(html).toContain(text);
    for (const domain of ['bugherd.com', 'marker.io', 'usersnap.com', 'usepastel.com', 'userback.io', 'www.ruttl.com'])
        expect(html).toContain(`href="https://${domain}/`);
    expect(/<time\b[^>]*datetime="2026-11-11"/i.test(html)).toBe(true);
    expect(/<time\b[^>]*datetime="2026-11-15"/i.test(html)).toBe(true);
    expect(/<time\b[^>]*datetime="2026-11-19"/i.test(html)).toBe(true);
    expect(html).toContain('href="/features/pinned-comments#preview-a-change"');
    expect(html).toContain('edit mode is unavailable in web app projects');
    expect(html).not.toContain('No live site editing');
    expect(html).toContain('Custom statuses and labels');
    expect(html).not.toContain('no custom statuses');
    expect(html).not.toContain('1,000 recent threads');
});

test('new alternatives publish their own evidence and canonical HTML', async ({ request }) => {
    for (const [slug, name, evidence] of [
        ['userback', 'Userback', 'https://docs.userback.io/docs/userback-mcp'],
        ['ruttl', 'ruttl', 'https://www.ruttl.com/mcp']
    ]) {
        const response = await request.get(`/compare/${slug}?source=audit`, { headers: { 'User-Agent': 'Googlebot' } });
        expect(response.status()).toBe(200);
        const html = await response.text();
        expect(html).toContain(`uier vs ${name}`);
        expect(html).toContain(`rel="canonical" href="https://uier.io/compare/${slug}"`);
        expect(html).toContain(`href="${evidence}"`);
        expect(html).toContain('A fictional example, not a customer result.');
        expect(html).toContain('href="/guides/mcp"');
        expect(/<time\b[^>]*datetime="2026-11-15"/i.test(html)).toBe(true);
    }
});
