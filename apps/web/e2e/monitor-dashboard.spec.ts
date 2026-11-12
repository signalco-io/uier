import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { createProject, openComment, projectPublicId, signIn, uniqueEmail } from './support/app';
import { commentBubble, openThread, toolbar } from './support/toolbar';

// The uier monitor's local dashboard (plugins/uier/skills/uier-monitor/scripts/dashboard.mjs) started
// with `--review`: it loads the toolbar for a project and widens its own Content-Security-Policy to
// the toolbar's sources. A change to what the toolbar loads must not break commenting on it.

const dashboard = fileURLToPath(new URL('../../../plugins/uier/skills/uier-monitor/scripts/dashboard.mjs', import.meta.url));

async function freePort() {
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as { port: number };
    await new Promise(resolve => server.close(resolve));
    return port;
}

test('the monitor dashboard loads the toolbar under its own CSP, and a member comments on a card', async ({ page, baseURL }, testInfo) => {
    const dir = mkdtempSync(join(tmpdir(), 'uier-monitor-dashboard-'));
    let child: ChildProcess | undefined;
    try {
        const port = await freePort();
        const origin = `http://127.0.0.1:${port}`;
        await signIn(page, uniqueEmail('dashboard'));
        const projectId = await createProject(page, { urls: [origin], name: 'Monitor dashboard' });
        const publicId = await projectPublicId(page, projectId);

        // One monitor with a group in progress, so the page has a card to comment on.
        writeFileSync(join(dir, 'state.json'), JSON.stringify({
            project: { id: 'fixture', name: 'Fixture monitor' }, updatedAt: new Date().toISOString(),
            items: { a: { number: 7, decision: 'accepted', stage: 'in-progress' } },
            groups: { g7: { items: ['a'], state: 'building', model: 'claude-opus-5-5', effort: 'high', startedAt: new Date().toISOString() } }
        }));
        let output = '';
        child = spawn(process.execPath, [dashboard, '--port', String(port), '--review', publicId, '--state', dir], {
            cwd: tmpdir(), stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, UIER_REVIEW_URL: new URL(baseURL!).origin, UIER_MONITOR_HOME: join(dir, 'home') }
        });
        child.stdout!.on('data', chunk => { output += chunk; });
        child.stderr!.on('data', chunk => { output += chunk; });
        await expect.poll(() => output, { message: 'the dashboard starts' }).toContain(origin);

        const violations: string[] = [];
        page.on('console', message => { if (/Content Security Policy/i.test(message.text())) violations.push(message.text()); });
        // The app's review link signs the toolbar in on the dashboard
        await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(`${origin}/`)}`);
        await expect(page).toHaveURL(`${origin}/?toolbar-code=${publicId}`);
        await expect(page.getByRole('article', { name: 'Fixture monitor' })).toContainText('Building');
        await expect(toolbar(page)).toBeVisible();

        await page.getByRole('button', { name: 'Add comment' }).click();
        const card = await page.getByRole('heading', { name: 'Fixture monitor' }).boundingBox();
        await page.mouse.click(card!.x + 10, card!.y + card!.height / 2);
        const composer = page.getByRole('textbox', { name: 'Comment', exact: true });
        await composer.fill('The card needs the repository name.');
        await composer.press('Enter');
        await expect(commentBubble(page, 1)).toBeVisible();
        await expect(openThread(page).getByText('You', { exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        // The dashboard keeps updating in place under the toolbar: the pin's card is still the same element
        await expect(page.getByRole('article', { name: 'Fixture monitor' })).toBeVisible();
        expect(violations).toEqual([]);

        // The page asks for this project's toolbar and nothing else from another origin
        const served = await fetch(`${origin}/`);
        expect(await served.text()).toContain(`data-uier-project="${publicId}"`);
        expect(served.headers.get('content-security-policy')).toContain(`script-src 'nonce-`);
        expect(served.headers.get('content-security-policy')).not.toContain('unsafe');

        await page.goto(`/app/projects/${projectId}`);
        const comment = await openComment(page, /^Comment/);
        await expect(comment).toContainText('The card needs the repository name.');
        await expect(comment).toContainText(`127.0.0.1:${port}`);
        await expect(comment).toContainText(testInfo.project.name.startsWith('Mobile') ? 'Mobile' : 'Desktop');
    } finally {
        if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
        rmSync(dir, { recursive: true, force: true });
    }
});
