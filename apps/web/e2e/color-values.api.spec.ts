import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from '@playwright/test';
import { colorParts, cssColor } from '@uier/toolbar/color-values';
import { ColorText as AppColorText } from '../src/components/app/comments/ColorText';
import { MessageMarkdown as AppMessageMarkdown } from '../src/components/app/comments/MessageMarkdown';
import { ColorText as ToolbarColorText } from '../../../packages/toolbar/src/components/ColorText';
import { MessageMarkdown as ToolbarMessageMarkdown } from '../../../packages/toolbar/src/components/MessageMarkdown';

// Colour values in text people write (`@uier/toolbar/color-values`) and the swatch the app and the toolbar
// put before each one. The browser side is `color-swatches.spec.ts`.

/** The values found in a text, as `[written, CSS colour]` */
const found = (text: string) => colorParts(text).filter(part => part.color).map(part => [part.text, part.color]);
/** Markup without each side's classes */
const tags = (html: string) => html.replace(/ class="[^"]*"/g, '');
const swatch = (color: string) => `<span aria-hidden="true" data-color-swatch="" style="background-color:${color}"></span>`;

test('hex colours are found where they are written as colours', () => {
    expect(found('Logo should be this color: #ED1C24')).toEqual([['#ED1C24', '#ed1c24']]);
    expect(found('#fff, #FFFA; (#0a84ff) "#0A84FF80" bg-[#171717] color:#000 fill=#333')).toEqual([
        ['#fff', '#fff'], ['#FFFA', '#fffa'], ['#0a84ff', '#0a84ff'], ['#0A84FF80', '#0a84ff80'], ['#171717', '#171717'], ['#000', '#000'], ['#333', '#333']]);
    // A comment, an issue or a pull request number is not a colour; six digits, a leading zero and the greys are
    expect(found('See uier #389, PR #719 and #1234')).toEqual([]);
    expect(found('#123456 #080 #0008 #999 #4444')).toEqual([['#123456', '#123456'], ['#080', '#080'], ['#0008', '#0008'], ['#999', '#999'], ['#4444', '#4444']]);
    // Five or seven digits, a longer word, an id, a URL fragment, an entity and a doubled sign are not
    expect(found('#12345 #abcdefa #abcdefabc #fffx #add-comment #bad_id page#abc https://uier.io/#fff https://uier.io/a?b=1#abc &#123; ##fff #')).toEqual([]);
    // Joining the parts gives the text back
    const text = 'a #fff\nb rgb(1, 2, 3) c';
    expect(colorParts(text).map(part => part.text).join('')).toBe(text);
    expect(colorParts('')).toEqual([{ text: '' }]);
    expect(colorParts('No colour (here)')).toEqual([{ text: 'No colour (here)' }]);
});

test('colour functions are checked before they count and written again from their parts', () => {
    expect(found('rgb(255, 0, 0) RGBA(255,0,0,.5) rgb(100%, 0%, 0%) rgb(10 132 255) rgb(100% 0% 0% / 50%) rgb(none 0 0)')).toEqual([
        ['rgb(255, 0, 0)', 'rgb(255, 0, 0)'], ['RGBA(255,0,0,.5)', 'rgb(255, 0, 0, .5)'], ['rgb(100%, 0%, 0%)', 'rgb(100%, 0%, 0%)'],
        ['rgb(10 132 255)', 'rgb(10 132 255)'], ['rgb(100% 0% 0% / 50%)', 'rgb(100% 0% 0% / 50%)'], ['rgb(none 0 0)', 'rgb(none 0 0)']]);
    expect(found('hsl(120, 50%, 50%) hsla(120deg, 50%, 50%, 0.5) hsl(  0.5turn   50%  50%  ) hsl(120 50 50 / none)')).toEqual([
        ['hsl(120, 50%, 50%)', 'hsl(120, 50%, 50%)'], ['hsla(120deg, 50%, 50%, 0.5)', 'hsl(120deg, 50%, 50%, 0.5)'],
        ['hsl(  0.5turn   50%  50%  )', 'hsl(0.5turn 50% 50%)'], ['hsl(120 50 50 / none)', 'hsl(120 50 50 / none)']]);
    expect(found('oklch(0.7 0.15 250) oklab(70% 0.1 -0.1 / 0.5) lab(50 40 -20) lch(50 40 120deg) hwb(120 10% 20%)').map(([, color]) => color)).toEqual([
        'oklch(0.7 0.15 250)', 'oklab(70% 0.1 -0.1 / 0.5)', 'lab(50 40 -20)', 'lch(50 40 120deg)', 'hwb(120 10% 20%)']);
    expect(found('color(display-p3 1 0 0) color(srgb 1 0 0 / 0.5)').map(([, color]) => color)).toEqual(['color(display-p3 1 0 0)', 'color(srgb 1 0 0 / 0.5)']);
    // The wrong number or kind of values, other functions, names and anything that is not a number
    expect(found([
        'rgb(1, 2) rgb(1 2 3 4) rgb(1, 2%, 3) rgb(1,,3) rgb(1 2 3 /) rgb(1 2 3 / 1 / 1) rgb(1e3 0 0) rgb(10deg 0 0) rgb(none, 0, 0)',
        'hsl(120, 50, 50) hsl(50% 50% 50%) hwb(120 10 20) hwb(120, 10%, 20%) lab(1, 2, 3) lch(50 40 50%) color(foo 1 0 0) color(srgb 1 0)',
        'rgb(var(--x)) rgb(calc(1) 2 3) rgb(from red r g b) color-mix(in srgb, red, blue) var(--brand) red rebeccapurple transparent',
        'argb(1, 2, 3) collab(1 2 3) theme.rgb(1, 2, 3) background-color(srgb 1 0 0) constructor(1 2 3) toString(1 2 3) rgb() rgb( )'
    ].join(' '))).toEqual([]);
    expect(cssColor(' #FFF ')).toBe('#fff');
    expect(cssColor('OKLCH(70% 0.1 250 / 50%)')).toBe('oklch(70% 0.1 250 / 50%)');
    for (const value of ['red', '#389', '#ff', 'rgb(1 2 3);x', 'constructor(1 2 3)', '__proto__(1 2 3)', 'rgb(1 2 3) rgb(1 2 3)', 'rgb(1\n2 3)', '']) expect(cssColor(value), value).toBeUndefined();
});

test('a colour is only ever a checked value, however the text is written', () => {
    const hostile = [
        'rgb(0 0 0);background:url(https://evil.example/x)', 'rgb(0 0 0;background:url(https://evil.example/x))', 'rgb(0,0,0)}body{display:none',
        '#fff;position:fixed', '#fff"onmouseover="alert(1)', 'rgb(0 0 0 / 1)<script>alert(1)</script>', 'hsl(0 0% 0% / expression(alert(1)))', 'rgb(0 0 0 /*x*/)',
        'rgb(0 0 0 !important)', 'rgb(0\\, 0, 0)', 'color(srgb 1 0 0 / url(x))'
    ];
    for (const text of hostile) {
        for (const part of colorParts(text)) if (part.color) expect(part.color, text).toMatch(/^(?:#[0-9a-f]{3,8}|[a-z]+\([a-z0-9 .,%/+-]+\))$/);
        for (const component of [AppMessageMarkdown, ToolbarMessageMarkdown]) {
            const html = renderToStaticMarkup(createElement(component, { text }));
            for (const [, style] of html.matchAll(/style="([^"]*)"/g)) expect(style, text).toMatch(/^background-color:(?:#[0-9a-f]{3,8}|[a-z]+\([a-z0-9 .,%/+-]+\))$/);
            expect(html).not.toContain('<script');
            expect(html).not.toContain('onmouseover="');
        }
    }
    // Long and repetitive text stays quick
    for (const text of ['#fff '.repeat(20_000), 'rgb('.repeat(20_000), 'rgb(1 '.repeat(20_000), '#'.repeat(50_000), `rgb(${'1 '.repeat(50_000)})`, 'oklch(0.7 0.15 250) '.repeat(5_000)]) {
        const started = performance.now();
        colorParts(text);
        expect(performance.now() - started, text.slice(0, 12)).toBeLessThan(500);
    }
});

test('the app and the toolbar put the same swatch before a colour, in text and code spans', () => {
    const source = 'Use **#ED1C24** on `#FFFFFF`, not uier #389.\n\n- oklch(0.7 0.15 250 / 50%)\n\n```css\n.logo { color: #ED1C24; }\n```';
    const app = renderToStaticMarkup(createElement(AppMessageMarkdown, { text: source }));
    const toolbar = renderToStaticMarkup(createElement(ToolbarMessageMarkdown, { text: source }));
    expect(tags(app)).toBe(tags(toolbar));
    // The value stays as written after its swatch; the first characters stay on the swatch's line. Fenced code is as written
    expect(tags(app)).toBe('<div data-markdown=""><p>Use <strong>' + `<span>${swatch('#ed1c24')}#ED1C24</span>` + '</strong> on <code>' + `<span>${swatch('#ffffff')}#FFFFFF</span>` + '</code>, not uier #389.</p>'
        + `<ul><li><p><span>${swatch('oklch(0.7 0.15 250 / 50%)')}oklch(0.</span>7 0.15 250 / 50%)</p></li></ul>`
        + '<pre><code>.logo { color: #ED1C24; }</code></pre></div>');
    // The swatch: the brand's 4 px tag corner and hairline border, its colour kept in forced colours, hidden from assistive technology
    for (const html of [app, toolbar]) expect(html).toContain('<span aria-hidden="true" data-color-swatch="" style="background-color:#ed1c24" class="mr-1 inline-block size-3 rounded-[4px] border border-border align-[-1px] forced-color-adjust-none"></span>');
    // Titles and draft previews: plain text with the same swatch
    for (const component of [AppColorText, ToolbarColorText]) {
        expect(tags(renderToStaticMarkup(createElement(component, { text: 'Logo color should be #ED1C24' })))).toBe(`Logo color should be <span>${swatch('#ed1c24')}#ED1C24</span>`);
        expect(renderToStaticMarkup(createElement(component, { text: 'Fix <b> & #389' }))).toBe('Fix &lt;b&gt; &amp; #389');
    }
});
