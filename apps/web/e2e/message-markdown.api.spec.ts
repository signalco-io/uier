import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from '@playwright/test';
import { markdownPlainText, parseMarkdown, safeHref, type MarkdownBlock, type MarkdownInline, type MarkdownMention } from '@uier/toolbar/markdown';
import { MessageMarkdown as AppMessageMarkdown } from '../src/components/app/comments/MessageMarkdown';
import { MessageMarkdown as ToolbarMessageMarkdown } from '../../../packages/toolbar/src/components/MessageMarkdown';
import { getAppStore } from '../src/lib/app/store';
import { findOrCreateUser, updateUserName } from '../src/lib/app/users';
import { memberId, projectRefPk, workspacePk, type DbMember, type DbProject, type DbProjectRef } from '../src/lib/app/model';
import type { AppContext } from '../src/lib/app/context';
import { loadProjectComments } from '../src/lib/app/projectComments';
import { createProjectComment, replyToProjectComment } from '../src/lib/review/comments';
import { memberActor } from '../src/lib/review/actor';

const paragraph = (...children: MarkdownInline[]): MarkdownBlock => ({ type: 'paragraph', children });
const text = (value: string): MarkdownInline => ({ type: 'text', text: value });
const link = (href: string, ...children: MarkdownInline[]): MarkdownInline => ({ type: 'link', href, title: href, children });
/** Every link in a tree */
function links(blocks: MarkdownBlock[]): Extract<MarkdownInline, { type: 'link' }>[] {
    const found: Extract<MarkdownInline, { type: 'link' }>[] = [];
    const inline = (nodes: MarkdownInline[]) => nodes.forEach(node => {
        if (node.type === 'link') found.push(node);
        if ('children' in node) inline(node.children);
    });
    const walk = (nodes: MarkdownBlock[]) => nodes.forEach(block => {
        if (block.type === 'paragraph' || block.type === 'heading') inline(block.children);
        if (block.type === 'quote') walk(block.children);
        if (block.type === 'list') block.items.forEach(walk);
    });
    walk(blocks);
    return found;
}
/** How deep emphasis and links nest */
function depth(nodes: MarkdownInline[]): number {
    return Math.max(0, ...nodes.map(node => 'children' in node ? 1 + depth(node.children) : 0));
}
const render = (component: typeof AppMessageMarkdown, value: string, mentions?: MarkdownMention[], suffix?: string) =>
    renderToStaticMarkup(createElement(component, { text: value, mentions, suffix: suffix && createElement('span', null, suffix) }));

test('thread messages read the Markdown subset agents write', () => {
    // An agent's reply: a code span inside a link, a link in parentheses
    expect(parseMarkdown('Fixed in [`abc1234`](https://github.com/signalco-io/uier/commit/abc1234) ([PR #450](https://github.com/signalco-io/uier/pull/450)), deployed to uier.io.')).toEqual([
        paragraph(text('Fixed in '), link('https://github.com/signalco-io/uier/commit/abc1234', { type: 'code', text: 'abc1234' }), text(' ('),
            link('https://github.com/signalco-io/uier/pull/450', text('PR #450')), text('), deployed to uier.io.'))
    ]);
    // Line breaks stay line breaks; a blank line starts a paragraph; spaces and a backslash before a break are hard breaks
    expect(parseMarkdown('One\nTwo  \nThree\\\nFour\n\n\nNext')).toEqual([paragraph(text('One\nTwo\nThree\nFour')), paragraph(text('Next'))]);
    expect(parseMarkdown('**bold** __bold__ *em* _em_ ~~gone~~ `code` ***both***')).toEqual([paragraph(
        { type: 'strong', children: [text('bold')] }, text(' '), { type: 'strong', children: [text('bold')] }, text(' '),
        { type: 'em', children: [text('em')] }, text(' '), { type: 'em', children: [text('em')] }, text(' '),
        { type: 'del', children: [text('gone')] }, text(' '), { type: 'code', text: 'code' }, text(' '),
        { type: 'em', children: [{ type: 'strong', children: [text('both')] }] })]);
    // Words with underscores, a lone tilde and unmatched markers are text
    expect(parseMarkdown('snake_case_name ~5 min * not a list 2 ** 3')).toEqual([paragraph(text('snake_case_name ~5 min * not a list 2 ** 3'))]);
    // Escapes and code spans keep Markdown characters
    expect(parseMarkdown('\\*not emphasis\\* `**not bold**` `` a ` b ``')).toEqual([paragraph(text('*not emphasis* '), { type: 'code', text: '**not bold**' }, text(' '), { type: 'code', text: 'a ` b' })]);
    expect(parseMarkdown('```ts\nconst a = 1 < 2;\n  **not bold**\n```\nAfter')).toEqual([
        { type: 'code', language: 'ts', text: 'const a = 1 < 2;\n  **not bold**' }, paragraph(text('After'))]);
    // An unclosed fence runs to the end
    expect(parseMarkdown('~~~\ncode')).toEqual([{ type: 'code', text: 'code' }]);
    expect(parseMarkdown('Steps:\n- Open the page\n- Click **Save**\n  - on a phone\n\n3. third\n4. fourth')).toEqual([
        paragraph(text('Steps:')),
        { type: 'list', ordered: false, start: 1, items: [
            [paragraph(text('Open the page'))],
            [paragraph(text('Click '), { type: 'strong', children: [text('Save')] }), { type: 'list', ordered: false, start: 1, items: [[paragraph(text('on a phone'))]] }]
        ] },
        { type: 'list', ordered: true, start: 3, items: [[paragraph(text('third'))], [paragraph(text('fourth'))]] }
    ]);
    // A quote ends at its last `>` line, so a reply typed under it stays outside
    expect(parseMarkdown('> The total\n> is cut off\nAgreed')).toEqual([{ type: 'quote', children: [paragraph(text('The total\nis cut off'))] }, paragraph(text('Agreed'))]);
    expect(parseMarkdown('## Summary ##\nTitle\n===\n\n---\n#hashtag')).toEqual([
        { type: 'heading', children: [text('Summary')] }, { type: 'heading', children: [text('Title')] }, { type: 'rule' }, paragraph(text('#hashtag'))]);
    // Bare addresses link without the punctuation after them; `<…>` autolinks; mailto
    expect(links(parseMarkdown('See https://uier.io/app?x=1. (https://example.com/a_(b)) <https://ok.example> <team@uier.io> [mail](mailto:team@uier.io)'))
        .map(({ href, children }) => [href, children.map(child => 'text' in child ? child.text : '').join('')])).toEqual([
        ['https://uier.io/app?x=1', 'https://uier.io/app?x=1'],
        ['https://example.com/a_(b)', 'https://example.com/a_(b)'],
        ['https://ok.example/', 'https://ok.example'],
        ['mailto:team@uier.io', 'team@uier.io'],
        ['mailto:team@uier.io', 'mail']
    ]);
    // No links inside links
    expect(parseMarkdown('[see https://a.example](https://b.example)')).toEqual([paragraph(link('https://b.example/', text('see https://a.example')))]);
    // Tables, reference links and indented code are not supported: they stay the text they were written as
    expect(parseMarkdown('| a | b |\n|---|---|\n[x][ref]\n\n    indented')).toEqual([paragraph(text('| a | b |\n|---|---|\n[x][ref]')), paragraph(text('indented'))]);
});

test('links open only http, https and mailto addresses, and their text never names another site', () => {
    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', ' javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=',
        'vbscript:msgbox(1)', 'file:///etc/passwd', '/app/projects', '//evil.example/x', '#top', 'mailto:', 'https://', ''])
        expect(safeHref(href), href).toBeUndefined();
    expect(safeHref('HTTPS://Example.com/a b')).toBe('https://example.com/a%20b');
    // A refused link stays as written, so the reader sees what it was
    for (const source of ['[click](javascript:alert(1))', '[x](data:text/html,<script>alert(1)</script>)', '![x](javascript:alert(1))', '<javascript:alert(1)>', '[relative](/app)', 'javascript:alert(1)']) {
        const tree = parseMarkdown(source);
        expect(links(tree), source).toEqual([]);
        expect(markdownPlainText(source), source).toBe(source);
    }
    // Link text that looks like an address on another site shows the real one; every link names its address
    expect(parseMarkdown('[https://uier.io/app](https://evil.example/login) [www.uier.io](https://uier.io/brand) [CommentCard.tsx](https://github.com/x)')).toEqual([paragraph(
        { type: 'link', href: 'https://evil.example/login', children: [text('https://evil.example/login')] }, text(' '),
        link('https://uier.io/brand', text('www.uier.io')), text(' '),
        link('https://github.com/x', text('CommentCard.tsx')))]);
});

test('raw HTML is text and images are links to them', () => {
    const source = '<img src=x onerror="alert(1)"> <script>alert(1)</script> <b>bold</b> ![Screenshot of the header](https://cdn.example/header.png) ![](https://cdn.example/a.png)';
    expect(parseMarkdown(source)).toEqual([paragraph(
        text('<img src=x onerror="alert(1)"> <script>alert(1)</script> <b>bold</b> '),
        link('https://cdn.example/header.png', text('Screenshot of the header')), text(' '),
        { type: 'link', href: 'https://cdn.example/a.png', children: [text('https://cdn.example/a.png')] })]);
    for (const component of [AppMessageMarkdown, ToolbarMessageMarkdown]) {
        const html = render(component, source);
        expect(html).not.toContain('<img');
        expect(html).not.toContain('<script');
        expect(html).not.toContain('<b>');
        expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
        expect(html).toContain('<a href="https://cdn.example/header.png" title="https://cdn.example/header.png" target="_blank" rel="noopener noreferrer nofollow ugc"');
    }
});

test('mentions stay whole inside and next to Markdown', () => {
    const mention = (value: string): MarkdownInline => ({ type: 'mention', text: value });
    // Ranges over the shown text, as the app sends them
    const shown = 'Hi @Ana, **@Bob** please check `@Ana` and [@Bob](https://uier.io)';
    const at = (needle: string, from = 0) => ({ start: shown.indexOf(needle, from), end: shown.indexOf(needle, from) + needle.length });
    expect(parseMarkdown(shown, [at('@Ana'), at('@Bob'), at('@Ana', 20), at('@Bob', 40)])).toEqual([paragraph(
        text('Hi '), mention('@Ana'), text(', '), { type: 'strong', children: [mention('@Bob')] }, text(' please check '),
        { type: 'code', text: '@Ana' }, text(' and '), link('https://uier.io/', mention('@Bob')))]);
    // Names as the toolbar gets them: never read as Markdown, wherever they are
    expect(parseMarkdown('@x said **hi**', [{ start: 0, end: 2, name: '*Ana_ [x](https://evil.example)' }])).toEqual([paragraph(
        mention('@*Ana_ [x](https://evil.example)'), text(' said '), { type: 'strong', children: [text('hi')] })]);
    // A mention right before or after a delimiter, at the start of a line, in a list and in a code block
    expect(parseMarkdown('**@x**done\n@x - not a list\n- @x\n```\n@x\n```', [0, 0, 0, 0].map((_, index) => {
        const source = '**@x**done\n@x - not a list\n- @x\n```\n@x\n```';
        let start = -1;
        for (let found = 0; found <= index; found++) start = source.indexOf('@x', start + 1);
        return { start, end: start + 2, name: 'Ana Lee' };
    }))).toEqual([
        paragraph({ type: 'strong', children: [mention('@Ana Lee')] }, text('done\n'), mention('@Ana Lee'), text(' - not a list')),
        { type: 'list', ordered: false, start: 1, items: [[paragraph(mention('@Ana Lee'))]] },
        { type: 'code', text: '@Ana Lee' }
    ]);
    // Ranges that overlap or fall outside the text are ignored; private use characters in the text are text
    expect(parseMarkdown(' @Ana ', [{ start: 2, end: 6 }, { start: 3, end: 5 }, { start: 5, end: 99 }])).toEqual([paragraph(text(' '), mention('@Ana'), text(' '))]);
    expect(markdownPlainText('**Ask** @x about it', [{ start: 8, end: 10, name: 'Ana' }])).toBe('Ask @Ana about it');
    for (const component of [AppMessageMarkdown, ToolbarMessageMarkdown])
        expect(render(component, 'Hi @Ana', [{ start: 3, end: 7 }])).toContain('Hi <span data-mention="">@Ana</span>');
});

test('very long and adversarial messages parse quickly and stay shallow', () => {
    const inputs = [
        '*a _b '.repeat(20_000), '**'.repeat(5_000) + 'x' + '**'.repeat(5_000), '['.repeat(10_000) + ']('.repeat(10_000), '`'.repeat(3_000) + 'x',
        '>'.repeat(5_000) + ' deep', Array.from({ length: 2_000 }, (_, index) => ' '.repeat(index * 2) + '- x').join('\n'), 'https://a.example/' + '('.repeat(20_000),
        `${'a'.repeat(1_000)} https://example.com/${'b'.repeat(2_000)} \`${'c'.repeat(2_000)}\``, '[a]('.repeat(10_000), '# ' + ' '.repeat(20_000) + 'x'
    ];
    for (const input of inputs) {
        const started = performance.now();
        const tree = parseMarkdown(input);
        expect(performance.now() - started, input.slice(0, 20)).toBeLessThan(1_000);
        const inlines = (blocks: MarkdownBlock[]): MarkdownInline[] => blocks.flatMap(block => block.type === 'paragraph' || block.type === 'heading' ? block.children
            : block.type === 'quote' ? inlines(block.children) : block.type === 'list' ? block.items.flatMap(inlines) : []);
        expect(depth(inlines(tree))).toBeLessThanOrEqual(13);
        expect(() => render(AppMessageMarkdown, input)).not.toThrow();
        expect(() => render(ToolbarMessageMarkdown, input)).not.toThrow();
    }
    // Nested lists and quotes stop nesting after eight levels; deeper markers are text
    const nested = (blocks: MarkdownBlock[]): number => Math.max(0, ...blocks.map(block => block.type === 'quote' ? 1 + nested(block.children) : block.type === 'list' ? 1 + Math.max(0, ...block.items.map(nested)) : 0));
    expect(nested(parseMarkdown('>'.repeat(50) + ' deep'))).toBe(8);
});

test('the app and the toolbar render the same safe markup', () => {
    const source = '### Fixed\nThe **total** wraps on phones. See [PR #450](https://github.com/signalco-io/uier/pull/450).\n\n3. Build\n4. Deploy\n\n> Checked on Edge\n\n```\nnpm test\n```';
    const app = render(AppMessageMarkdown, source, undefined, ' (edited)');
    const toolbar = render(ToolbarMessageMarkdown, source, undefined, ' (edited)');
    // The same elements, with each side's classes
    const tags = (html: string) => html.replace(/ class="[^"]*"/g, '');
    expect(tags(app)).toBe(tags(toolbar));
    expect(tags(app)).toBe('<div data-markdown=""><p>Fixed</p><p>The <strong>total</strong> wraps on phones. See '
        + '<a href="https://github.com/signalco-io/uier/pull/450" title="https://github.com/signalco-io/uier/pull/450" target="_blank" rel="noopener noreferrer nofollow ugc">PR #450</a>.</p>'
        + '<ol start="3"><li><p>Build</p></li><li><p>Deploy</p></li></ol><blockquote><p>Checked on Edge</p></blockquote>'
        + '<pre><code>npm test</code></pre><p><span> (edited)</span></p></div>');
    // "(edited)" ends the last paragraph when there is one
    expect(tags(render(AppMessageMarkdown, 'Plain text', undefined, ' (edited)'))).toBe('<div data-markdown=""><p>Plain text<span> (edited)</span></p></div>');
    // Headings are bold text, never a heading in the page's outline; links use the link colour; code is on the muted surface
    expect(app).not.toMatch(/<h[1-6]/);
    expect(app).toContain('<p class="m-0 font-semibold whitespace-pre-wrap">Fixed</p>');
    expect(app).toContain('text-[hsl(var(--brand-accent-text))]');
    expect(app).toMatch(/<pre class="[^"]*bg-muted[^"]*whitespace-pre-wrap/);
    expect(app).toContain('[overflow-wrap:anywhere]');
});

test('list rows show the first message without its Markdown', () => {
    expect(markdownPlainText('**Fixed** in [`abc1234`](https://github.com/x) ([PR #450](https://github.com/y))\n- deployed')).toBe('Fixed in abc1234 (PR #450)\ndeployed');
    expect(markdownPlainText('# The header\n> quoted\n```\ncode\n```')).toBe('The header\nquoted\ncode');
});

test('the app sends where mentions are in the text it shows, after names change', async () => {
    const previous = process.env.UIER_LOCAL;
    process.env.UIER_LOCAL = '1';
    try {
        const id = randomUUID().replaceAll('-', '').slice(0, 12);
        const owner = await findOrCreateUser(`markdown-owner-${id}@example.com`);
        const ana = await findOrCreateUser(`markdown-ana-${id}@example.com`);
        await updateUserName(ana.id, 'Ana');
        const workspaceId = `w_${owner.id}`;
        const old = '2026-01-01T00:00:00.000Z';
        const project: DbProject = { type: 'project', id, pk: workspacePk(workspaceId), workspaceId, name: `Markdown ${id}`, urls: ['https://reviewed.example'],
            status: 'active', access: 'guests', createdBy: owner.id, createdAt: old, updatedAt: old };
        await getAppStore().create(project);
        await getAppStore().create<DbProjectRef>({ type: 'project-ref', id, pk: projectRefPk(id), workspaceId });
        for (const [user, role] of [[owner, 'admin'], [ana, 'commenter']] as const)
            await getAppStore().create<DbMember>({ type: 'member', id: memberId(user.id), pk: project.pk, workspaceId, userId: user.id, email: user.email, role, projects: 'all', createdAt: old });
        const admin = (await memberActor(project, owner.id))!;
        const request = new Request('http://127.0.0.1/api/review');
        const comment = await createProjectComment(request, project, admin, { text: '**@Ana** check the `header`', origin: project.urls[0]!,
            path: '/', pageStateVersion: 1, position: { type: 'page' }, kind: 'feedback', mentions: [{ userId: ana.id, start: 2, end: 6 }] });
        await replyToProjectComment(request, project, admin, comment.id, { text: 'Thanks @Ana and @Ana', mentions: [{ userId: ana.id, start: 7, end: 11 }, { userId: ana.id, start: 16, end: 20 }] });
        await updateUserName(ana.id, 'Ana Lee-Marković');

        const [view] = await loadProjectComments({ user: owner, isAdmin: true } as AppContext, project);
        expect(view!.displayText).toBe('**@Ana Lee-Marković** check the `header`');
        expect(view!.displayMentions).toEqual([{ start: 2, end: 19 }]);
        const reply = view!.replies[0]!;
        expect(reply.text).toBe('Thanks @Ana Lee-Marković and @Ana Lee-Marković');
        expect(reply.mentions).toEqual([{ start: 7, end: 24 }, { start: 29, end: 46 }]);
        expect(parseMarkdown(view!.displayText, view!.displayMentions)).toEqual([paragraph(
            { type: 'strong', children: [{ type: 'mention', text: '@Ana Lee-Marković' }] }, text(' check the '), { type: 'code', text: 'header' })]);
    } finally {
        if (previous === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previous;
    }
});
