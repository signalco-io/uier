import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, test } from '@playwright/test';
import type { CommentPoint, CommentSelection } from '../../../packages/toolbar/src/components/@types/Comments';

declare global {
    interface Window {
        proposalEngine: typeof import('../../../packages/toolbar/src/proposalPreview')
            & Pick<typeof import('../../../packages/toolbar/src/hooks/useCommentItemRects'), 'getCommentPlacement'>;
    }
}

const point: CommentPoint = { type: 'point', selector: '#target', xNormal: 0, yNormal: 0 };
let bundle: string;

test.beforeAll(async () => {
    const result = await build({
        stdin: { contents: `
            import { readProposalTarget, startProposalPreview } from './proposalPreview';
            import { getCommentPlacement } from './hooks/useCommentItemRects';
            window.proposalEngine = { readProposalTarget, startProposalPreview, getCommentPlacement };
        `, resolveDir: fileURLToPath(new URL('../../../packages/toolbar/src/', import.meta.url)) },
        bundle: true, write: false, platform: 'browser', format: 'iife',
        define: { __UIER_DEV__: 'false', __UIER_API_URL__: JSON.stringify('https://uier.test'), 'process.env.NODE_ENV': JSON.stringify('production') },
    });
    bundle = result.outputFiles[0]!.text;
});

test.beforeEach(async ({ page }) => {
    await page.route('https://proposal-engine.test/**', route => route.fulfill({ contentType: 'text/html', body: '<main></main>' }));
    await page.goto('https://proposal-engine.test/');
    await page.addScriptTag({ content: bundle });
});

test('point authoring and replay share the whole visible label, excluding hidden icon text', async ({ page }) => {
    const result = await page.evaluate(position => {
        document.querySelector('main')!.innerHTML = '<button id="target" style="color: navy !important; padding: 3px 6px"><svg aria-hidden="true"><title>Arrow</title></svg>Get started</button>';
        const { readProposalTarget, startProposalPreview } = window.proposalEngine;
        const target = document.querySelector<HTMLButtonElement>('#target')!;
        const icon = target.firstElementChild;
        const originalStyle = target.style.cssText;
        const original = readProposalTarget(position)!;
        let clicks = 0;
        icon!.addEventListener('click', () => { clicks++; });
        const proposed = '<strong>Explore</strong>';
        const proposal = { text: { original: original.text!, proposed }, styles: { color: { original: original.styles.color!, proposed: '#ff0000' } } };
        const stop = startProposalPreview(position, proposal);
        icon!.dispatchEvent(new Event('click'));
        const during = [target.lastChild!.textContent, target.querySelector('strong') === null, getComputedStyle(target).color];
        stop?.();
        const restored = [target.lastChild!.textContent, target.firstElementChild === icon, target.style.cssText === originalStyle];

        target.lastChild!.textContent = 'Get started today';
        const newBaseline = readProposalTarget(position)?.text;
        const replay = startProposalPreview(position, proposal);
        return { original, during, restored, clicks, newBaseline, replay: Boolean(replay), staleRead: readProposalTarget(position, original.text)?.text,
            afterStaleReplay: [target.lastChild!.textContent, target.style.cssText === originalStyle] };
    }, point);
    expect(result).toMatchObject({ original: { text: 'Get started', styles: { color: 'rgb(0, 0, 128)', 'padding-top': '3px' } },
        during: ['<strong>Explore</strong>', true, 'rgb(255, 0, 0)'], restored: ['Get started', true, true], clicks: 1,
        newBaseline: 'Get started today', replay: false, afterStaleReplay: ['Get started today', true] });
    expect(result.staleRead).toBeUndefined();
});

test('saved offsets scope a repeated selection and the pin follows its edited text', async ({ page }) => {
    const position: CommentSelection = {
        type: 'text', text: 'Get started', startSelector: '#target', startType: 'text', startOffset: 25,
        endType: 'text', endOffset: 14,
    };
    const result = await page.evaluate(position => {
        document.querySelector('main')!.innerHTML = '<p id="target">Get started / Get started today</p><p>Get started</p>';
        const { getCommentPlacement, readProposalTarget, startProposalPreview } = window.proposalEngine;
        const target = document.querySelector('#target')!;
        const original = readProposalTarget(position)?.text;
        const stop = startProposalPreview(position, { text: { original: 'Get started', proposed: 'Continue' }, styles: {} });
        const during = [target.textContent, getCommentPlacement({ ...position }).state];
        stop?.();
        const restored = target.textContent;
        const stale = { ...position, startOffset: 40 };
        const missing = { ...position, startSelector: '#missing' };
        target.className = 'repeated';
        document.querySelector('p:last-child')!.className = 'repeated';
        const ambiguous = { ...position, startSelector: '.repeated' };
        return { original, during, restored, unavailable: [stale, missing, ambiguous].map(anchor => readProposalTarget(anchor)) };
    }, position);
    expect(result).toEqual({ original: 'Get started', during: ['Get started / Continue today', 'exact'],
        restored: 'Get started / Get started today', unavailable: [null, null, null] });
});

test('a change may leave nested link copy intact but cannot redistribute copy across markup', async ({ page }) => {
    const result = await page.evaluate(position => {
        document.querySelector('main')!.innerHTML = '<p id="target">Read <a href="/help">the guide</a>.</p>';
        const { startProposalPreview } = window.proposalEngine;
        const target = document.querySelector('#target')!;
        const link = target.querySelector('a');
        const original = 'Read the guide.';
        const unsafe = startProposalPreview(position, { text: { original, proposed: 'Open settings' }, styles: {} });
        const stop = startProposalPreview(position, { text: { original, proposed: 'See the guide.' }, styles: {} });
        const during = [target.textContent, target.querySelector('a') === link, link?.textContent, link?.getAttribute('href')];
        stop?.();
        return { unsafe: Boolean(unsafe), during, after: target.textContent };
    }, point);
    expect(result).toEqual({ unsafe: false, during: ['See the guide.', true, 'the guide', '/help'], after: 'Read the guide.' });
});

test('an empty replacement has a pin and adjacent framework text nodes survive restoration', async ({ page }) => {
    const position: CommentSelection = {
        type: 'text', text: 'Get started', startSelector: '#target', startType: 'text', startOffset: 0,
        endType: 'text', endOffset: 11,
    };
    const result = await page.evaluate(position => {
        document.querySelector('main')!.innerHTML = '<p id="target"></p>';
        const target = document.querySelector('#target')!;
        const first = document.createTextNode('Get ');
        const second = document.createTextNode('started');
        target.append(first, second);
        const stop = window.proposalEngine.startProposalPreview(position, { text: { original: 'Get started', proposed: '' }, styles: {} });
        const during = [target.textContent, window.proposalEngine.getCommentPlacement(position).rects.length];
        stop?.();
        return { during, after: [first.data, second.data, target.firstChild === first, target.lastChild === second] };
    }, position);
    expect(result).toEqual({ during: ['', 1], after: ['Get ', 'started', true, true] });
});

test('style cleanup preserves host changes and restores the other affected declarations', async ({ page }) => {
    const result = await page.evaluate(async position => {
        document.querySelector('main')!.innerHTML = '<p id="target" style="padding: 2px 3px !important; border-radius: 1px 2px 3px 4px; color: navy">Original</p>';
        const { readProposalTarget, startProposalPreview } = window.proposalEngine;
        const target = document.querySelector<HTMLElement>('#target')!;
        const original = readProposalTarget(position)!.styles;
        let invalidations = 0;
        const stop = startProposalPreview(position, { text: { original: 'Original', proposed: 'Preview' }, styles: {
            color: { original: original.color!, proposed: '#ff0000' },
            'padding-top': { original: original['padding-top']!, proposed: '8px' },
            'border-radius': { original: original['border-radius']!, proposed: '12px 4% / 5px 6px' },
        } }, () => invalidations++);
        const during = [getComputedStyle(target).paddingTop, getComputedStyle(target).borderTopRightRadius, target.textContent];
        target.style.setProperty('margin-left', '9px');
        await new Promise<void>(resolve => queueMicrotask(resolve));
        const afterUnrelatedWrite = [getComputedStyle(target).paddingTop, invalidations];
        target.style.setProperty('border-top-right-radius', '20px', 'important');
        target.firstChild!.textContent = 'Host copy';
        // Stop before the observer callback can run. Its pending records still count as host writes.
        stop?.();
        const style = target.style;
        return { during, afterUnrelatedWrite, restored: [style.paddingTop, style.paddingRight, style.getPropertyPriority('padding-top'),
            style.borderTopLeftRadius, style.borderTopRightRadius, style.getPropertyPriority('border-top-right-radius'),
            style.color, style.marginLeft, target.textContent, invalidations] };
    }, point);
    expect(result).toEqual({ during: ['8px', '4% 6px', 'Preview'], afterUnrelatedWrite: ['8px', 0],
        restored: ['2px', '3px', 'important', '1px', '20px', 'important', 'navy', '9px', 'Host copy', 0] });
});

test('style restoration works under a strict attribute policy and preserves logical padding precedence', async ({ page }) => {
    await page.route('https://proposal-engine.test/restricted', route => route.fulfill({
        contentType: 'text/html', headers: { 'content-security-policy': "style-src-attr 'none'" }, body: '<p id="target">Original</p>',
    }));
    await page.goto('https://proposal-engine.test/restricted');
    await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(position => {
        const { readProposalTarget, startProposalPreview } = window.proposalEngine;
        const target = document.querySelector<HTMLElement>('#target')!;
        target.style.cssText = 'color: navy !important; padding-top: 2px !important; padding-block-start: 7px !important';
        const original = readProposalTarget(position)!.styles;
        const colorStop = startProposalPreview(position, { styles: { color: { original: original.color!, proposed: '#ff0000' } } });
        const previewColor = getComputedStyle(target).color;
        colorStop?.();
        const restoredColor = getComputedStyle(target).color;
        const paddingStop = startProposalPreview(position, { styles: { 'padding-top': { original: original['padding-top']!, proposed: '8px' } } });
        const previewPadding = getComputedStyle(target).paddingTop;
        target.style.marginTop = '11px';
        paddingStop?.();
        return { previewColor, restoredColor, previewPadding, restoredPadding: getComputedStyle(target).paddingTop, margin: target.style.marginTop };
    }, point);
    expect(result).toEqual({ previewColor: 'rgb(255, 0, 0)', restoredColor: 'rgb(0, 0, 128)', previewPadding: '8px', restoredPadding: '7px', margin: '11px' });
});

test('framework replacements invalidate once and restore detached nodes without editing the new tree', async ({ page }) => {
    const result = await page.evaluate(async position => {
        document.querySelector('main')!.innerHTML = '<p id="target">Original</p>';
        const target = document.querySelector<HTMLElement>('#target')!;
        const old = target.firstChild!;
        let invalidations = 0;
        const stop = window.proposalEngine.startProposalPreview(position, { text: { original: 'Original', proposed: 'Preview' }, styles: {} }, () => invalidations++);
        target.replaceChildren(document.createTextNode('Framework render'));
        await new Promise<void>(resolve => queueMicrotask(resolve));
        stop?.();
        return { detached: old.textContent, current: target.textContent, invalidations };
    }, point);
    expect(result).toEqual({ detached: 'Original', current: 'Framework render', invalidations: 1 });
});

test('form and editable content, ambiguous anchors, stale styles and unsafe CSS values fail closed', async ({ page }) => {
    const result = await page.evaluate(position => {
        document.querySelector('main')!.innerHTML = '<p id="target">Original</p><form><p id="form">Original</p></form>'
            + '<div contenteditable><p id="editable">Original</p></div><p role="textbox" id="textbox">Original</p><input id="password" type="password" value="Original">'
            + '<p class="duplicate">Original</p><p class="duplicate">Original</p>';
        const { readProposalTarget, startProposalPreview } = window.proposalEngine;
        const exclusions = ['#form', '#editable', '#textbox', '#password', '.duplicate'].map(selector => readProposalTarget({ ...position, selector }));
        const original = readProposalTarget(position)!.styles.color!;
        const text = { original: 'Original', proposed: 'Preview' };
        const rejected = ['var(--host-color)', 'url(https://invalid.test)', 'red; padding: 0', '#000 !important'].map(proposed =>
            Boolean(startProposalPreview(position, { text, styles: { color: { original, proposed } } })));
        const mismatch = startProposalPreview(position, { text, styles: { color: { original: 'rgb(1, 1, 1)', proposed: '#00ff00' } } });
        return { exclusions, rejected, mismatch: Boolean(mismatch), text: document.querySelector('#target')!.textContent };
    }, point);
    expect(result).toEqual({ exclusions: [null, null, null, null, null], rejected: [false, false, false, false], mismatch: false, text: 'Original' });
});

test('starting a second preview and same-document navigation restore active previews', async ({ page }) => {
    const result = await page.evaluate(async position => {
        document.querySelector('main')!.innerHTML = '<p id="target">Original</p><p id="other">Other</p>';
        const texts = () => [...document.querySelectorAll('main p')].map(element => element.textContent);
        const { startProposalPreview } = window.proposalEngine;
        let invalidations = 0;
        const first = startProposalPreview(position, { text: { original: 'Original', proposed: 'First preview' }, styles: {} }, () => invalidations++);
        startProposalPreview({ ...position, selector: '#other' }, { text: { original: 'Other', proposed: 'Second preview' }, styles: {} }, () => invalidations++);
        first?.();
        const during = texts();
        history.pushState(null, '', '/another-page');
        await new Promise<void>(resolve => queueMicrotask(resolve));
        return { during, after: texts(), invalidations };
    }, point);
    expect(result).toEqual({ during: ['Original', 'Second preview'], after: ['Original', 'Other'], invalidations: 2 });
});
