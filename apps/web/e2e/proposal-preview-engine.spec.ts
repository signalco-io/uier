import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, test } from '@playwright/test';
import type { CommentPoint, CommentSelection } from '../../../packages/toolbar/src/components/@types/Comments';

declare global {
    interface Window {
        proposalEngine: typeof import('../../../packages/toolbar/src/proposalPreview')
            & Pick<typeof import('../../../packages/toolbar/src/hooks/useCommentItemRects'), 'getCommentPlacement'>
            & typeof import('../../../packages/toolbar/src/anchorSelector')
            & Pick<typeof import('../../../packages/toolbar/src/proposalSession'), 'holdProposalSessions' | 'showProposalSession'>;
    }
}

const point: CommentPoint = { type: 'point', selector: '#target', xNormal: 0, yNormal: 0 };
let bundle: string;

test.beforeAll(async () => {
    const result = await build({
        stdin: { contents: `
            import { anchorSelector, hasIndependentAnchorSelector, withoutAnchorOrdinals } from './anchorSelector';
            import { readProposalTarget, startProposalPreview, withProposalTargetIdentity } from './proposalPreview';
            import { holdProposalSessions, showProposalSession } from './proposalSession';
            import { getCommentPlacement } from './hooks/useCommentItemRects';
            window.proposalEngine = { anchorSelector, hasIndependentAnchorSelector, withoutAnchorOrdinals,
                readProposalTarget, startProposalPreview, withProposalTargetIdentity, getCommentPlacement,
                holdProposalSessions, showProposalSession };
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

test('a rendered selection replays at its raw offsets and preserves its source whitespace', async ({ page }) => {
    const result = await page.evaluate(() => {
        const main = document.querySelector('main')!;
        main.innerHTML = '<p id="target"></p>';
        const target = main.firstElementChild!;
        const prefix = 'Try our bread / ';
        const raw = 'Try  our\n  bread';
        const suffix = ' today';
        const node = document.createTextNode(prefix + raw + suffix);
        target.append(node);
        const range = document.createRange();
        range.setStart(node, prefix.length);
        range.setEnd(node, prefix.length + raw.length);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        const text = selection.toString();
        selection.removeAllRanges();
        const position = {
            type: 'text', text, startSelector: '#target', startType: 'text', startOffset: prefix.length,
            endType: 'text', endOffset: prefix.length + raw.length,
        } as const;
        const { getCommentPlacement, readProposalTarget, showProposalSession } = window.proposalEngine;
        const read = readProposalTarget(position)?.text;
        const states: string[] = [];
        const stop = showProposalSession(position, { text: { original: text, proposed: 'Try the bread' }, styles: {} }, state => states.push(state));
        const during = [node.data, getCommentPlacement(position).state];
        stop();
        return { text, read, states, during, restored: node.data, sameNode: target.firstChild === node };
    });
    expect(result).toEqual({ text: 'Try our bread', read: 'Try our bread', states: ['proposed', 'original'],
        during: ['Try our bread / Try  the\n  bread today', 'exact'],
        restored: 'Try our bread / Try  our\n  bread today', sameNode: true });
});

test('legacy selection quotes replay literally while significant whitespace mismatches are stale', async ({ page }) => {
    const result = await page.evaluate(() => {
        const main = document.querySelector('main')!;
        main.innerHTML = '<p id="target"></p>';
        const target = main.firstElementChild as HTMLElement;
        const { readProposalTarget, startProposalPreview } = window.proposalEngine;
        const replay = (raw: string, text: string, original: string, whiteSpace: string) => {
            target.style.whiteSpace = whiteSpace;
            target.textContent = raw;
            const position = {
                type: 'text', text, startSelector: '#target', startType: 'text', startOffset: 0,
                endType: 'text', endOffset: raw.length,
            } as const;
            const available = readProposalTarget(position, original)?.text;
            const stop = startProposalPreview(position, { text: { original, proposed: 'Try the bread' }, styles: {} });
            const during = target.textContent;
            stop?.();
            return [available ?? null, during, target.textContent];
        };
        return {
            trimmed: replay('  Try  our bread  ', ' Try our bread ', 'Try our bread', 'normal'),
            raw: replay('Try  our bread', 'Try our bread', 'Try  our bread', 'normal'),
            preserved: replay('Try  our\n bread', 'Try  our\n bread', 'Try  our\n bread', 'pre-wrap'),
            changedPreserved: replay('Try  our\n bread', 'Try our bread', 'Try our bread', 'pre-wrap'),
            changedBreak: replay('Try\nour bread', 'Try our bread', 'Try our bread', 'pre-line'),
            storedBreak: replay('Try our bread', 'Try\nour bread', 'Try\nour bread', 'normal'),
            nonBreaking: replay('Try\u00a0our bread', 'Try our bread', 'Try our bread', 'normal'),
        };
    });
    expect(result).toEqual({
        trimmed: ['Try our bread', '  Try  the bread  ', '  Try  our bread  '],
        raw: ['Try  our bread', 'Try the bread', 'Try  our bread'],
        preserved: ['Try  our\n bread', 'Try the bread', 'Try  our\n bread'],
        changedPreserved: [null, 'Try  our\n bread', 'Try  our\n bread'],
        changedBreak: [null, 'Try\nour bread', 'Try\nour bread'],
        storedBreak: [null, 'Try our bread', 'Try our bread'],
        nonBreaking: [null, 'Try\u00a0our bread', 'Try\u00a0our bread'],
    });
});

test('normalized selection edits preserve adjacent markup and reject changes crossing its boundary', async ({ page }) => {
    const result = await page.evaluate(() => {
        document.querySelector('main')!.innerHTML = '<p id="target">Try  <a href="/bread"> our bread</a></p>';
        const target = document.querySelector('#target')!;
        const link = target.querySelector('a')!;
        const position = {
            type: 'text', text: 'Try our bread', startSelector: '#target', startType: 'text', startOffset: 0,
            endSelector: '#target a', endType: 'text', endOffset: link.textContent!.length,
        } as const;
        const { startProposalPreview } = window.proposalEngine;
        const preview = (proposed: string) => startProposalPreview(position, { text: { original: position.text, proposed }, styles: {} });
        const unsafe = preview('Explore pastries');
        const stop = preview('Try our rolls');
        const during = [target.textContent, link.textContent, target.querySelector('a') === link];
        stop?.();
        return { unsafe: Boolean(unsafe), during, restored: target.textContent };
    });
    expect(result).toEqual({ unsafe: false, during: ['Try   our rolls', ' our rolls', true], restored: 'Try   our bread' });
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

test('transitioning styles settle before capture or immediate replay and preserve host changes', async ({ page }) => {
    const result = await page.evaluate(async position => {
        document.querySelector('main')!.innerHTML = '<style>button { color: navy; opacity: 1; transition: color 250ms, opacity 30s; }</style>'
            + '<button id="target">Original</button>';
        const target = document.querySelector<HTMLButtonElement>('#target')!;
        const { holdProposalSessions, readProposalTarget, showProposalSession } = window.proposalEngine;
        const computed = () => getComputedStyle(target).color;
        const original = readProposalTarget(position)!.styles.color!;
        const proposed = (color: string) => ({ styles: { color: { original, proposed: color } } });
        const states: string[] = [];
        const notify = (state: string) => states.push(state);
        let clicks = 0;
        target.addEventListener('click', () => {
            target.style.opacity = '.6';
            target.style.marginLeft = `${++clicks}px`;
        });
        showProposalSession(position, proposed('#ff0000'), notify);
        const preview = computed();
        // Also test restoration from a fully displayed preview, even if an older engine
        // starts a transition on the way to it.
        const colorTransitions = target.getAnimations().filter(animation =>
            animation instanceof CSSTransition && animation.transitionProperty === 'color');
        await Promise.all(colorTransitions.map(animation => animation.finished));
        const beforeCapture = computed();
        target.click();
        const opacityTransition = () => target.getAnimations().find(animation =>
            animation instanceof CSSTransition && animation.transitionProperty === 'opacity');
        const hostTransition = opacityTransition();
        const release = holdProposalSessions();
        const originalAtCapture = computed();
        const stop = showProposalSession(position, proposed('#008000'), notify);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const originalNextFrame = computed();
        release();
        const replay = computed();
        stop();
        const restored = computed();
        const stopImmediate = showProposalSession(position, proposed('#ff0000'), notify);
        const immediateReplay = computed();
        stopImmediate();
        target.click();
        return {
            preview, beforeCapture, originalAtCapture, originalNextFrame, replay, restored, immediateReplay, states,
            hostTransition: Boolean(hostTransition && opacityTransition() === hostTransition),
            transition: getComputedStyle(target).transitionProperty, clicks, margin: target.style.marginLeft,
        };
    }, point);
    expect(result).toEqual({
        preview: 'rgb(255, 0, 0)', beforeCapture: 'rgb(255, 0, 0)',
        originalAtCapture: 'rgb(0, 0, 128)', originalNextFrame: 'rgb(0, 0, 128)',
        replay: 'rgb(0, 128, 0)', restored: 'rgb(0, 0, 128)', immediateReplay: 'rgb(255, 0, 0)',
        states: ['proposed', 'original', 'pending', 'proposed', 'original', 'proposed', 'original'],
        hostTransition: true, transition: 'color, opacity', clicks: 2, margin: '2px',
    });
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

test('CSS-only point replay keeps its captured identity through reorder and reload', async ({ page }) => {
    const markup = '<ul id="list" style="color: navy"><li>First label</li><li>Second label</li></ul>';
    const result = await page.evaluate(async ({ point, markup }) => {
        document.querySelector('main')!.innerHTML = markup;
        const list = document.getElementById('list')!;
        const [first, second] = Array.from(list.children) as [HTMLLIElement, HTMLLIElement];
        const { anchorSelector, readProposalTarget, startProposalPreview, withProposalTargetIdentity } = window.proposalEngine;
        const position = withProposalTargetIdentity({ ...point, selector: anchorSelector(first) }, first);
        const before = readProposalTarget(position)!;
        const proposal = { styles: { color: { original: before.styles.color!, proposed: '#ff0000' } } };
        let invalidations = 0;
        const stop = startProposalPreview(position, proposal, () => invalidations++);
        const previewColor = getComputedStyle(first).color;
        list.prepend(second);
        await Promise.resolve();
        const reordered = { colors: [getComputedStyle(first).color, getComputedStyle(second).color], invalidations,
            read: readProposalTarget(position), replayed: Boolean(startProposalPreview(position, proposal)) };
        stop?.();
        return { position, proposal, previewColor, reordered };
    }, { point, markup });
    expect(result.position).toMatchObject({ selector: '#list>li:nth-of-type(1)', proposalLabelHash: /^v1-[0-9a-f]{16}$/ });
    expect(JSON.stringify(result.position)).not.toContain('First label');
    expect(result.previewColor).toBe('rgb(255, 0, 0)');
    expect(result.reordered).toEqual({ colors: ['rgb(0, 0, 128)', 'rgb(0, 0, 128)'], invalidations: 1, read: null, replayed: false });

    await page.reload();
    await page.addScriptTag({ content: bundle });
    const afterReload = await page.evaluate(({ markup, position, proposal }) => {
        document.querySelector('main')!.innerHTML = markup;
        const list = document.getElementById('list')!;
        list.prepend(list.lastElementChild!);
        return {
            replayed: Boolean(window.proposalEngine.startProposalPreview(position, proposal)),
            colors: Array.from(list.children, element => getComputedStyle(element).color)
        };
    }, { markup, position: result.position, proposal: result.proposal });
    expect(afterReload).toEqual({ replayed: false, colors: ['rgb(0, 0, 128)', 'rgb(0, 0, 128)'] });
});

test('structural point labels must stay unique even while the preview edits the target text', async ({ page }) => {
    const result = await page.evaluate(async point => {
        document.querySelector('main')!.innerHTML = '<ul id="list"><li>First label</li><li>Second label</li></ul>';
        const list = document.getElementById('list')!;
        const first = list.firstElementChild!;
        const { anchorSelector, readProposalTarget, startProposalPreview, withProposalTargetIdentity } = window.proposalEngine;
        const pointAtFirst = { ...point, selector: anchorSelector(first) };
        const position = withProposalTargetIdentity(pointAtFirst, first);
        const proposal = { styles: {}, text: { original: 'First label', proposed: 'Preview text' } };
        let invalidations = 0;
        const stop = startProposalPreview(position, proposal, () => invalidations++);
        const during = first.textContent;
        const duplicate = document.createElement('li');
        duplicate.textContent = 'First label';
        list.append(duplicate);
        await Promise.resolve();
        const duplicatePosition = withProposalTargetIdentity(pointAtFirst, first);
        const duplicateRead = readProposalTarget(position);
        const duplicateReplay = startProposalPreview(position, proposal);
        stop?.();
        return { during, invalidations, restored: first.textContent, duplicate: duplicate.textContent,
            recaptured: 'proposalLabelHash' in duplicatePosition, duplicateRead, duplicateReplay: Boolean(duplicateReplay) };
    }, point);
    expect(result).toEqual({ during: 'Preview text', invalidations: 1, restored: 'First label', duplicate: 'First label',
        recaptured: false, duplicateRead: null, duplicateReplay: false });
});

test('legacy CSS requires an independent selector and legacy point text requires a unique original label', async ({ page }) => {
    const result = await page.evaluate(point => {
        document.querySelector('main')!.innerHTML = '<ul id="list" style="color: navy"><li>First label</li><li>Second label</li></ul><p id="target" style="color: navy"></p>';
        const { readProposalTarget, startProposalPreview } = window.proposalEngine;
        const structural = { ...point, selector: '#list>li:nth-of-type(1)' };
        const css = { styles: { color: { original: 'rgb(0, 0, 128)', proposed: '#ff0000' } } };
        const legacyText = { styles: {}, text: { original: 'First label', proposed: 'Preview text' } };
        const structuralCss = startProposalPreview(structural, css);
        const independentCss = startProposalPreview(point, css);
        independentCss?.();
        const structuralText = startProposalPreview(structural, legacyText);
        structuralText?.();
        document.querySelector('#list li:last-child')!.textContent = 'First label';
        return { structuralRead: readProposalTarget(structural), structuralCss: Boolean(structuralCss),
            independentCss: Boolean(independentCss), structuralText: Boolean(structuralText),
            duplicateText: Boolean(startProposalPreview(structural, legacyText)) };
    }, point);
    expect(result).toEqual({ structuralRead: null, structuralCss: false, independentCss: true, structuralText: true, duplicateText: false });
});
