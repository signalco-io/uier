import { expect, test } from '@playwright/test';
import { docToMarkdown, markdownToDoc } from '../../../packages/toolbar/src/editor/markdownDoc';
import { editorSchema as schema } from '../../../packages/toolbar/src/editor/schema';

type Node = ReturnType<typeof markdownToDoc>;

// The rich editor (`@uier/toolbar/editor`) shows a message's Markdown formatted and saves Markdown again:
// what it saves must read back as what was written, formatting and mentions included, and text the
// person typed must never turn into formatting.

const paragraph = (...content: Node[]) => schema.nodes.paragraph.create(null, content);
const doc = (...blocks: Node[]) => schema.nodes.doc.create(null, blocks);
const text = (value: string) => schema.text(value);

test('formatted Markdown comes back as it was written', () => {
    for (const markdown of [
        '**Bold** and *italic*, ~~gone~~ and `code`',
        'See [the pricing page](https://uier.io/pricing) first',
        '# Title\n\n## Summary\n\nThe table overlaps the footer.',
        '- one\n- two\n  - nested\n- three',
        '3. third\n4. fourth',
        '> The total\n> is cut off\n\nAgreed',
        '```ts\nconst total = items.length * 2;\n```',
        'Above\n\n---\n\nBelow',
        'First line\nsecond line\n\nNext paragraph',
        '***Both*** at once'
    ]) {
        const { text: saved } = docToMarkdown(markdownToDoc(markdown));
        expect(saved, markdown).toBe(markdown);
    }
    expect(markdownToDoc('## Summary').firstChild!.attrs.level).toBe(2);
    expect(markdownToDoc('Title\n===').firstChild!.attrs.level).toBe(1);
});

test('typed text stays text: only what would become formatting gets a backslash', () => {
    const cases: [string, string][] = [
        ['2 * 3 * 4 and snake_case_name', '2 * 3 * 4 and snake_case_name'],
        ['*not italic* and **not bold**', '\\*not italic\\* and \\*\\*not bold\\*\\*'],
        ['# not a heading', '\\# not a heading'],
        ['- not a list', '\\- not a list'],
        ['1. not a list', '1\\. not a list'],
        ['> not a quote', '\\> not a quote'],
        ['---', '\\---'],
        ['[label](https://uier.io)', '[label\\](https://uier.io)'],
        ['a `tick', 'a \\`tick'],
        ['https://uier.io/a_b_c?x=1', 'https://uier.io/a_b_c?x=1'],
        // The address ends before the `*`, so it goes in `<…>` where the backslash after it can not join it
        ['https://uier.io/a_b_c?x=*y*', '<https://uier.io/a_b_c?x=*y>\\*'],
        ['C:\\Users\\new', 'C:\\Users\\new']
    ];
    for (const [typed, markdown] of cases) {
        const written = doc(paragraph(text(typed)));
        const saved = docToMarkdown(written).text;
        expect(saved, typed).toBe(markdown);
        expect(markdownToDoc(saved).eq(written), typed).toBe(true);
    }
});

test('a heading that ends in # keeps it, and a rule alone in a list item stays in the item', () => {
    const heading = doc(schema.nodes.heading.create({ level: 3 }, text('Support for C #')), paragraph());
    expect(docToMarkdown(heading).text).toBe('### Support for C \\#');
    expect(markdownToDoc(docToMarkdown(heading).text).firstChild!.textContent).toBe('Support for C #');
    const list = doc(schema.nodes.bullet_list.create(null, [
        schema.nodes.list_item.create(null, paragraph(text('one'))),
        schema.nodes.list_item.create(null, schema.nodes.horizontal_rule.create())
    ]), paragraph());
    const saved = docToMarkdown(list).text;
    expect(markdownToDoc(saved).firstChild!.childCount, saved).toBe(2);
});

test('mentions keep their person and their range, also inside formatting', () => {
    const saved = 'Thanks **@Ana Novak**, and @Ivo';
    const mentions = [{ userId: 'user-ana', start: 9, end: 19 }, { userId: 'user-ivo', start: 27, end: 31 }];
    const loaded = markdownToDoc(saved, mentions);
    const found: { id: string; label: string; bold: boolean }[] = [];
    loaded.descendants(node => {
        if (node.type === schema.nodes.mention) found.push({ id: node.attrs.id as string, label: node.attrs.label as string, bold: node.marks.some(mark => mark.type === schema.marks.strong) });
        return true;
    });
    expect(found).toEqual([{ id: 'user-ana', label: '@Ana Novak', bold: true }, { id: 'user-ivo', label: '@Ivo', bold: false }]);
    expect(docToMarkdown(loaded)).toEqual({ text: saved, mentions });

    // A mention written into new text gets its range where it ends up
    const written = doc(paragraph(text('Ask '), schema.nodes.mention.create({ id: 'user-ana', label: '@Ana' }), text(' about `x`')));
    expect(docToMarkdown(written)).toEqual({ text: 'Ask @Ana about \\`x\\`', mentions: [{ userId: 'user-ana', start: 4, end: 8 }] });
});

test('plain text of risky characters reads back unchanged (seeded)', () => {
    let seed = 290;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const alphabet = 'ab c*_~`[]()<>#-+1.\\!@=:/h'.split('');
    const word = (length: number) => Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
    const flat = (node: Node) => {
        let result = '';
        node.descendants(child => {
            if (child.isText) result += child.text + (child.marks.length ? `{${child.marks.map(mark => mark.type.name).join()}}` : '');
            else if (child.type === schema.nodes.hard_break) result += '\n';
            else if (child.isBlock && !child.isTextblock) result += `<${child.type.name}>`;
            return true;
        });
        return result.replace(/ *\n */g, '\n');
    };
    for (let run = 0; run < 3000; run++) {
        const lines: Node[] = [];
        const count = 1 + Math.floor(random() * 3);
        for (let line = 0; line < count; line++) {
            if (line) lines.push(schema.nodes.hard_break.create());
            let value = word(1 + Math.floor(random() * 12)).trim();
            if (random() < 0.2) value = `see https://example.com/${word(4).trim()}`;
            lines.push(text(value || 'x'));
        }
        const written = doc(paragraph(...lines));
        const saved = docToMarkdown(written).text;
        expect(flat(markdownToDoc(saved)), JSON.stringify(saved)).toBe(flat(written));
    }
});
