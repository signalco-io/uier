import { resolve } from 'node:path';
import { build } from 'esbuild';
import { expect, test } from '@playwright/test';

declare global {
    interface Window {
        anchorRecovery: Pick<typeof import('../../../packages/toolbar/src/modalLayer'), 'layerOpener' | 'layerOpenerIsExpanded'>
            & Pick<typeof import('../../../packages/toolbar/src/anchorSelector'), 'anchorSelector'>
            & Pick<typeof import('../../../packages/toolbar/src/hooks/useCommentItemRects'), 'getCommentPlacement'>;
    }
}

let bundle: string;
test.beforeAll(async () => {
    const result = await build({
        stdin: { contents: `
            import { followPageLayers, layerOpener, layerOpenerIsExpanded } from './modalLayer';
            import { anchorSelector } from './anchorSelector';
            import { getCommentPlacement } from './hooks/useCommentItemRects';
            const host = document.createElement('div');
            document.body.append(host);
            window[Symbol.for('uier.toolbar.host')] = host;
            followPageLayers(host);
            window.anchorRecovery = { layerOpener, layerOpenerIsExpanded, anchorSelector, getCommentPlacement };
        `, resolveDir: resolve('../../packages/toolbar/src') },
        bundle: true, write: false, platform: 'browser', format: 'iife',
        define: { __UIER_DEV__: 'false', __UIER_API_URL__: JSON.stringify('http://localhost:4404'), 'process.env.NODE_ENV': JSON.stringify('production') },
    });
    bundle = result.outputFiles[0]!.text;
});
test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://anchor.test/**', route => route.fulfill({ contentType: 'text/html', body: '<main></main>' }));
    await page.goto('http://anchor.test/');
    await page.addScriptTag({ content: bundle });
    expect(errors).toEqual([]);
});

for (const role of ['grid', 'tree', 'listbox', 'menu', 'dialog']) {
    test(`navigation to a static ${role} does not invent an opener`, async ({ page }) => {
        await page.evaluate(role => {
            document.querySelector('main')!.innerHTML = '<div tabindex="-1"><a href="#results">Results</a></div>';
            document.querySelector('a')!.addEventListener('click', () => {
                document.querySelector('main > div')!.insertAdjacentHTML('beforeend', `<section role="${role}"><p id="target">Result</p></section>`);
            });
        }, role);
        await page.getByRole('link', { name: 'Results' }).click();
        await expect(page.locator('#target')).toBeVisible();
        expect(await page.evaluate(() => window.anchorRecovery.layerOpener(document.querySelector('#target')!)?.outerHTML ?? null)).toBeNull();
    });
}

test('explicit collapsed state keeps a pin on a mounted empty listbox opener', async ({ page }) => {
    await page.evaluate(() => {
        document.querySelector('main')!.innerHTML = '<button id="select" role="combobox" aria-haspopup="listbox" aria-controls="choices" aria-expanded="true">Choose</button><div id="choices" role="listbox"><p id="choice">Option</p></div>';
    });
    expect(await page.evaluate(() => window.anchorRecovery.layerOpener(document.querySelector('#choice')!)?.id)).toBe('select');
    await page.evaluate(() => {
        document.querySelector('#select')!.setAttribute('aria-expanded', 'false');
        document.querySelector('#choices')!.replaceChildren();
    });
    expect(await page.evaluate(() => window.anchorRecovery.getCommentPlacement({ type: 'point', selector: '#choice', xNormal: 0, yNormal: 0, layer: { opener: '#select' } }).state)).toBe('closed');
    await page.evaluate(() => document.querySelector('#select')!.removeAttribute('aria-expanded'));
    expect(await page.evaluate(() => window.anchorRecovery.layerOpenerIsExpanded(document.querySelector('#select')!))).toBe(false);
});

test('expanded control relations outrank recorded triggers and unrelated presses clear activation', async ({ page }) => {
    await page.evaluate(() => {
        document.querySelector('main')!.innerHTML = '<button id="recorded">Open</button><button id="declared" aria-expanded="true" aria-controls="popup">Declared</button><p id="elsewhere">Elsewhere</p><div id="popup" role="dialog" aria-modal="true" hidden><p id="target">Content</p></div>';
        document.querySelector('#recorded')!.addEventListener('click', () => document.querySelector('#popup')?.removeAttribute('hidden'));
    });
    await page.locator('#recorded').click();
    await expect.poll(() => page.evaluate(() => window.anchorRecovery.layerOpener(document.querySelector('#target')!)?.id)).toBe('declared');
    await page.evaluate(() => {
        document.querySelector('#popup')!.remove();
        document.querySelector('#declared')!.removeAttribute('aria-expanded');
    });
    await page.locator('#recorded').click();
    await page.locator('#elsewhere').click({ button: 'right' });
    await page.evaluate(() => document.querySelector('main')!.insertAdjacentHTML('beforeend', '<div role="dialog" aria-modal="true"><p id="new-target">Context</p></div>'));
    await expect(page.locator('#new-target')).toBeVisible();
    expect(await page.evaluate(() => window.anchorRecovery.layerOpener(document.querySelector('#new-target')!)?.id ?? null)).toBeNull();
});

test('semantic selectors retain real ids and labels and skip generated framework ids', async ({ page }) => {
    const result = await page.evaluate(() => {
        const real = ['form:results:0', 'j_idt5:rows:2', 'user_r_list_', 'reach-us', 'base-ui-panel', 'radix-panel'];
        const generated = ['_r_0_', ':r1:', '«r2»', '_R_1a_', ':R1a:', 'base-ui-_r_3_', 'radix-:r4:', 'headlessui-dialog-12', 'react-aria5824-1', 'mui-123', 'base-ui-123', 'radix-123'];
        const selectors = (ids: string[]) => ids.map(id => {
            const element = document.createElement('button');
            element.id = id;
            document.querySelector('main')!.append(element);
            return window.anchorRecovery.anchorSelector(element);
        });
        const realSelectors = selectors(real);
        const generatedSelectors = selectors(generated);
        const label = document.createElement('button');
        label.setAttribute('aria-label', 'Reach-out');
        document.querySelector('main')!.append(label);
        return { real, realSelectors, generatedSelectors, label: window.anchorRecovery.anchorSelector(label) };
    });
    for (let i = 0; i < result.real.length; i++) expect(result.realSelectors[i]).toContain(`#${result.real[i]!.replaceAll(':', '\\:')}`);
    for (const selector of result.generatedSelectors) expect(selector).not.toContain('#');
    expect(result.label).toContain('[aria-label="Reach-out"]');
});
