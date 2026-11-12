import { baseKeymap, chainCommands, liftEmptyBlock, setBlockType, splitBlock, toggleMark, wrapIn } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { InputRule, inputRules, textblockTypeInputRule, undoInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import type { Attrs, MarkType } from 'prosemirror-model';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import { Plugin, TextSelection, type Command } from 'prosemirror-state';
import { safeHref } from '../markdown';
import { editorSchema as schema } from './schema';

const { nodes, marks } = schema;

/**
 * Markdown typed as you write: `**bold**`, `*italic*`, `~~strike~~`, `` `code` `` and `[text](https://…)` become the
 * formatted text once the closing delimiter is typed. The delimiters go; Backspace right after brings them back
 * (`undoInputRule`). `contentOffset`: where the text starts in the match's first group.
 */
function markRule(pattern: RegExp, type: MarkType, contentOffset: number, attrs?: (match: RegExpMatchArray) => Attrs | undefined) {
    return new InputRule(pattern, (state, match, start, end) => {
        const whole = match[1]!;
        const content = match[2]!;
        const attributes = attrs ? attrs(match) : null;
        if (attrs && !attributes) return null;
        const from = start + match[0].length - whole.length;
        const contentFrom = from + contentOffset;
        const contentTo = contentFrom + content.length;
        if (contentTo > end) return null;
        const tr = state.tr.delete(contentTo, end).delete(from, contentFrom);
        tr.addMark(from, from + content.length, type.create(attributes));
        // Writing on is plain text again
        tr.removeStoredMark(type);
        return tr;
    }, { inCodeMark: false });
}

/** `---`, `***` or `___` alone in a paragraph: a rule, and a paragraph after it to write on */
const ruleRule = new InputRule(/^(?:---|\*\*\*|___)$/, (state, _match, start, end) => {
    const $start = state.doc.resolve(start);
    if ($start.parent.type !== nodes.paragraph || $start.parentOffset !== 0 || end !== $start.end()) return null;
    const before = $start.before();
    const tr = state.tr.replaceWith(before, $start.after(), [nodes.horizontal_rule.create(), nodes.paragraph.create()]);
    return tr.setSelection(TextSelection.create(tr.doc, before + 2));
});

export const markdownInputRules = inputRules({
    rules: [
        // Blocks, at the start of a paragraph: `# ` to `###### `, `- `, `1. `, `> `, ```` ``` ```` and a space, `---`
        textblockTypeInputRule(/^(#{1,6})\s$/, nodes.heading, match => ({ level: match[1]!.length })),
        wrappingInputRule(/^\s*([-+*])\s$/, nodes.bullet_list),
        wrappingInputRule(/^(\d{1,9})([.)])\s$/, nodes.ordered_list, match => ({ order: Number(match[1]) }),
            (match, node) => node.childCount + (node.attrs.order as number) === Number(match[1])),
        wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
        textblockTypeInputRule(/^```([\w+#.-]*)\s$/, nodes.code_block, match => ({ language: match[1] ?? '' })),
        ruleRule,
        // Inline
        markRule(/(?:^|[^*\\])(\*\*([^*\s](?:[^*]*?[^*\s])?)\*\*)$/, marks.strong, 2),
        markRule(/(?:^|[^\w_\\])(__([^_\s](?:[^_]*?[^_\s])?)__)$/, marks.strong, 2),
        markRule(/(?:^|[^*\\])(\*([^*\s](?:[^*]*?[^*\s])?)\*)$/, marks.em, 1),
        markRule(/(?:^|[^\w_\\])(_([^_\s](?:[^_]*?[^_\s])?)_)$/, marks.em, 1),
        markRule(/(?:^|[^~\\])(~~([^~\s](?:[^~]*?[^~\s])?)~~)$/, marks.strike, 2),
        markRule(/(?:^|[^`\\])(`([^`]+)`)$/, marks.code, 1),
        markRule(/(?:^|[^!\\])(\[([^\]]+)\]\(([^()\s]+)\))$/, marks.link, 1, match => {
            const href = safeHref(match[3]!);
            return href ? { href } : undefined;
        })
    ]
});

/**
 * A new line, as Shift+Enter makes it (Enter sends): in a list, a new item, and out of the list from an empty
 * one; in code, a line break, and out of the code from a second empty line at its end; out of a quote from an
 * empty paragraph; after a heading, a paragraph; in a paragraph, a line break, and a new paragraph from a
 * second one (Markdown's blank line).
 */
export const newLine: Command = (state, dispatch) => {
    const { $from, $to } = state.selection;
    const parent = $from.parent;
    if (parent.type === nodes.code_block) {
        const atEnd = $to.parentOffset === parent.content.size;
        if (atEnd && state.selection.empty && parent.textContent.endsWith('\n')) {
            if (dispatch) {
                const after = $from.after();
                const tr = state.tr.delete($from.pos - 1, $from.pos);
                const position = tr.mapping.map(after);
                tr.insert(position, nodes.paragraph.create());
                dispatch(tr.setSelection(TextSelection.create(tr.doc, position + 1)).scrollIntoView());
            }
            return true;
        }
        dispatch?.(state.tr.insertText('\n').scrollIntoView());
        return true;
    }
    if ($from.depth >= 2 && $from.node(-1).type === nodes.list_item)
        return chainCommands(splitListItem(nodes.list_item), liftListItem(nodes.list_item))(state, dispatch);
    if (parent.type === nodes.paragraph && parent.content.size === 0 && $from.depth > 1) return liftEmptyBlock(state, dispatch);
    if (parent.type !== nodes.paragraph) return splitBlock(state, dispatch);
    if (state.selection.empty && $from.nodeBefore?.type === nodes.hard_break) {
        if (dispatch) {
            const tr = state.tr.delete($from.pos - 1, $from.pos);
            dispatch(tr.split(tr.mapping.map($from.pos)).scrollIntoView());
        }
        return true;
    }
    dispatch?.(state.tr.replaceSelectionWith(nodes.hard_break.create()).scrollIntoView());
    return true;
};

/** Backspace at the start of a heading or code block makes it a paragraph; after a mention, removes it whole */
const backspaceBlock: Command = (state, dispatch) => {
    const { $cursor } = state.selection as TextSelection;
    if (!$cursor) return false;
    if ($cursor.nodeBefore?.type === nodes.mention) {
        dispatch?.(state.tr.delete($cursor.pos - 1, $cursor.pos));
        return true;
    }
    if ($cursor.parentOffset > 0 || ($cursor.parent.type !== nodes.heading && $cursor.parent.type !== nodes.code_block)) return false;
    return setBlockType(nodes.paragraph)(state, dispatch);
};

/** After a rule or code block at the end there is always a paragraph to write in */
export const trailingParagraph = new Plugin({
    appendTransaction: (transactions, _old, state) => {
        if (!transactions.some(tr => tr.docChanged)) return null;
        const last = state.doc.lastChild;
        if (last?.type !== nodes.horizontal_rule && last?.type !== nodes.code_block) return null;
        return state.tr.insert(state.doc.content.size, nodes.paragraph.create());
    }
});

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/**
 * The editor's keys. Formatting: Ctrl/⌘+B bold, +I italic, +E code, +Shift+X strikethrough; Ctrl/⌘+Shift+7 a
 * numbered list, +Shift+8 a bulleted list, +Shift+9 a quote; Ctrl/⌘+Alt+1 to 3 a heading, +Alt+0 a paragraph.
 * Tab and Shift+Tab indent and outdent a list item (only then: elsewhere Tab moves the focus on).
 */
export const editorKeymap = [
    keymap({
        'Mod-z': undo,
        'Shift-Mod-z': redo,
        ...(mac ? {} : { 'Mod-y': redo }),
        'Backspace': chainCommands(undoInputRule, backspaceBlock),
        'Mod-b': toggleMark(marks.strong),
        'Mod-i': toggleMark(marks.em),
        'Mod-e': toggleMark(marks.code),
        'Shift-Mod-x': toggleMark(marks.strike),
        'Shift-Mod-7': wrapInList(nodes.ordered_list),
        'Shift-Mod-8': wrapInList(nodes.bullet_list),
        'Shift-Mod-9': wrapIn(nodes.blockquote),
        'Mod-Alt-0': setBlockType(nodes.paragraph),
        'Mod-Alt-1': setBlockType(nodes.heading, { level: 1 }),
        'Mod-Alt-2': setBlockType(nodes.heading, { level: 2 }),
        'Mod-Alt-3': setBlockType(nodes.heading, { level: 3 }),
        'Tab': sinkListItem(nodes.list_item),
        'Shift-Tab': liftListItem(nodes.list_item),
        'Shift-Enter': newLine,
        // Enter is the form's (send or save); without a form it is a new line too
        'Enter': newLine
    }),
    keymap(baseKeymap)
];
