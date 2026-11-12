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

// What a textblock shows: each character with its marks; spaces keep only code (Markdown writes them outside
// other marks) and the spaces at a line's edges go (the parser drops them)
function shown(block: Node) {
    const parts: string[] = [];
    block.forEach(child => {
        const names = (space: boolean) => child.marks
            .filter(mark => !space || mark.type === schema.marks.code)
            .map(mark => mark.type.name + (mark.attrs.href ? `(${mark.attrs.href as string})` : '')).join('+');
        if (child.type === schema.nodes.hard_break) parts.push('\n');
        else if (child.type === schema.nodes.mention) parts.push(`${child.attrs.id as string}:${names(false)}`);
        else for (const char of child.text ?? '') parts.push(`${char}:${names(/\s/.test(char))}`);
    });
    return parts.join('|').replace(/^(?:\s:\|)+|(?:\|\s:)+$/g, '').replace(/(?:\|\s:)*\|\n\|(?:\s:\|)*/g, '|\n|');
}

const strong = () => schema.marks.strong.create();
const em = () => schema.marks.em.create();
const strike = () => schema.marks.strike.create();
const code = () => schema.marks.code.create();
const link = (href = 'https://uier.io/pricing') => schema.marks.link.create({ href });
const marked = (value: string, ...marks: ReturnType<typeof strong>[]) => schema.text(value, marks);
const mention = (...marks: ReturnType<typeof strong>[]) => schema.nodes.mention.create({ id: 'user-ana', label: '@Ana' }, null, marks);

test('overlapping and adjacent formatting reads back as it was written', () => {
    const cases: [string, Node, string][] = [
        // uier #290 review: bold `ab`, then italic `bc`; `**a*b****c*` read back with literal asterisks
        ['bold ab, italic bc', doc(paragraph(marked('a', strong()), marked('b', strong(), em()), marked('c', em()))), '**a*b***_c_'],
        ['italic ab, bold bc', doc(paragraph(marked('a', em()), marked('b', strong(), em()), marked('c', strong()))), '*a**b***__c__'],
        ['overlapping words', doc(paragraph(marked('Ship ', strong()), marked('the', strong(), em()), marked(' fix', em()), text(' today'))), '**Ship *the*** *fix* today'],
        ['bold then italic', doc(paragraph(marked('bold', strong()), marked('italic', em()))), '**bold***italic*'],
        ['italic then bold', doc(paragraph(marked('italic', em()), marked('bold', strong()))), '*italic***bold**'],
        ['ending together', doc(paragraph(marked('very ', strong()), marked('important', strong(), em()), text('!'))), '**very *important***!'],
        ['next to punctuation', doc(paragraph(text('('), marked('bold, ', strong()), marked('both', strong(), em()), marked(')', em()), text('.'))), '(**bold, *both***_)_.'],
        ['strikethrough', doc(paragraph(marked('old ', strike()), marked('price', strike(), strong()), marked(' now', strong()))), '~~old **price**~~ **now**'],
        ['a link', doc(paragraph(text('see '), marked('the ', strong()), marked('pricing', strong(), link()), marked(' page', link()))), 'see **the [pricing](https://uier.io/pricing)** [page](https://uier.io/pricing)'],
        ['code', doc(paragraph(marked('run ', strong()), marked('pnpm dev', code()), marked(' now', strong()))), '**run** `pnpm dev` **now**'],
        ['a mention', doc(paragraph(marked('ask ', strong()), mention(strong(), em()), marked(' today', em()))), '**ask *@Ana*** *today*'],
        ['three marks', doc(paragraph(marked('a ', strong()), marked('b ', strong(), em()), marked('c ', strong(), em(), strike()), marked('d', em(), strike()), marked(' e', strike()))), '**a *b ~~c~~*** ~~*d* e~~'],
        // Spaces at the end of a mark go after its delimiter, also when they are a node of their own
        ['spaces before a closing delimiter', doc(paragraph(text('a'), marked('cb  ', strike()), marked(' ', strike(), strong()))), 'a~~cb~~   '],
        ['a heading', doc(schema.nodes.heading.create({ level: 2 }, [marked('a', strong()), marked('b', strong(), em()), marked('c', em())])), '## **a*b***_c_']
    ];
    for (const [name, written, markdown] of cases) {
        const saved = docToMarkdown(written);
        expect(saved.text, name).toBe(markdown);
        const read = markdownToDoc(saved.text, saved.mentions).firstChild!;
        expect(read.type, name).toBe(written.firstChild!.type);
        expect(shown(read), `${name}: ${saved.text}`).toBe(shown(written.firstChild!));
    }
});

test('formatting that overlaps inside a word keeps what Markdown can hold, never stray delimiters', () => {
    // Inside `xabcy`, bold `ab` and italic `bc` have no CommonMark form: the italic ends where the bold does
    const written = doc(paragraph(text('x'), marked('a', strong()), marked('b', strong(), em()), marked('c', em()), text('y')));
    const saved = docToMarkdown(written).text;
    expect(saved).toBe('x**a*b***cy');
    expect(shown(markdownToDoc(saved).firstChild!)).toBe(shown(doc(paragraph(text('x'), marked('a', strong()), marked('b', strong(), em()), text('cy'))).firstChild!));
});

test('formatting on words reads back as it was written (seeded)', () => {
    let seed = 2901;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
    const words = ['one', 'two', 'b', '(see', 'it)', 'end.', 'a,', '@', 'x_y', '2*3', '"q"', '-'];
    const kinds = [strong, em, strike, code, () => link(), () => link('https://uier.io/a')];
    for (let run = 0; run < 3000; run++) {
        const count = 2 + Math.floor(random() * 5);
        const tokens = Array.from({ length: count }, () => pick(words));
        const marks: (readonly ReturnType<typeof strong>[])[] = tokens.map(() => []);
        for (let range = 1 + Math.floor(random() * 3); range > 0; range--) {
            const start = Math.floor(random() * count);
            const end = start + 1 + Math.floor(random() * (count - start));
            const mark = pick(kinds)();
            for (let index = start; index < end; index++) marks[index] = mark.addToSet(marks[index]!);
        }
        const content: Node[] = [];
        tokens.forEach((token, index) => {
            // Code holds no other mark here but a link (as the editor's schema allows it)
            const own = marks[index]!.some(mark => mark.type === schema.marks.code)
                ? marks[index]!.filter(mark => mark.type === schema.marks.code || mark.type === schema.marks.link) : marks[index]!;
            const spaceMarks = index + 1 < count ? own.filter(mark => mark.isInSet(marks[index + 1]!)) : [];
            content.push(token === '@' ? mention(...own.filter(mark => mark.type !== schema.marks.code)) : marked(token, ...own));
            if (index + 1 < count) content.push(marked(' ', ...spaceMarks.filter(mark => mark.type !== schema.marks.code)));
        });
        const written = doc(paragraph(...content));
        const saved = docToMarkdown(written);
        expect(shown(markdownToDoc(saved.text, saved.mentions).firstChild!), JSON.stringify(saved.text)).toBe(shown(written.firstChild!));
    }
});
