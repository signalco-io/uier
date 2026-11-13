import type { ReactNode } from 'react';
import { parseMarkdown, type MarkdownBlock, type MarkdownInline, type MarkdownMention } from '@uier/toolbar/markdown';
import { ColorText } from './ColorText';

// The toolbar's `MessageMarkdown` (packages/toolbar/src/components) renders the same tree: change both together.
// Colour values in text and code spans get a swatch (`ColorText`); fenced code stays as written.
// Code has a hairline border as well as the muted surface: in dark mode a popover is the muted colour.

function inlines(nodes: MarkdownInline[]): ReactNode[] {
    return nodes.map((node, index) => {
        switch (node.type) {
            case 'text': return <ColorText key={index} text={node.text} />;
            case 'mention': return <span key={index} data-mention="">{node.text}</span>;
            case 'code': return <code key={index} className="rounded-sm border border-border bg-muted px-1 font-mono text-[13px]"><ColorText text={node.text} /></code>;
            case 'strong': return <strong key={index} className="font-semibold">{inlines(node.children)}</strong>;
            case 'em': return <em key={index}>{inlines(node.children)}</em>;
            case 'del': return <del key={index}>{inlines(node.children)}</del>;
            case 'link': return (
                <a key={index} href={node.href} title={node.title} target="_blank" rel="noopener noreferrer nofollow ugc"
                    className="text-[hsl(var(--brand-accent-text))] underline underline-offset-2">
                    {inlines(node.children)}
                </a>
            );
        }
    });
}

function blocks(nodes: MarkdownBlock[], end?: ReactNode): ReactNode[] {
    return nodes.map((block, index) => {
        const suffix = index === nodes.length - 1 ? end : undefined;
        switch (block.type) {
            case 'paragraph': return <p key={index} className="m-0 whitespace-pre-wrap">{inlines(block.children)}{suffix}</p>;
            // Headings are bold text: a message is not a document with its own outline
            case 'heading': return <p key={index} className="m-0 font-semibold whitespace-pre-wrap">{inlines(block.children)}{suffix}</p>;
            case 'code': return (
                <pre key={index} className="m-0 rounded-md border border-border bg-muted px-2.5 py-2 font-mono text-[13px] leading-5 whitespace-pre-wrap">
                    <code>{block.text}</code>
                </pre>
            );
            case 'quote': return <blockquote key={index} className="m-0 flex flex-col gap-2 border-l-2 border-border pl-2.5 text-secondary-foreground">{blocks(block.children)}</blockquote>;
            case 'list': {
                const items = block.items.map((item, itemIndex) => <li key={itemIndex} className="space-y-1 pl-0.5 marker:text-muted-foreground">{blocks(item)}</li>);
                return block.ordered
                    ? <ol key={index} start={block.start === 1 ? undefined : block.start} className="m-0 flex list-decimal flex-col gap-1 pl-5">{items}</ol>
                    : <ul key={index} className="m-0 flex list-disc flex-col gap-1 pl-5">{items}</ul>;
            }
            case 'rule': return <hr key={index} className="m-0 border-0 border-t border-border" />;
        }
    });
}

/**
 * The text of a thread message with its Markdown (`@uier/toolbar/markdown`): bold, lists, code, links that
 * open in a new tab, and mentions as their names. `suffix` ends the last paragraph ("(edited)").
 */
export function MessageMarkdown({ text, mentions, suffix }: { text: string; mentions?: readonly MarkdownMention[]; suffix?: ReactNode }) {
    const tree = parseMarkdown(text, mentions);
    const last = tree[tree.length - 1];
    const inline = last?.type === 'paragraph' || last?.type === 'heading';
    return (
        <div data-markdown="" className="flex min-w-0 flex-col gap-2 text-sm leading-6 [overflow-wrap:anywhere]">
            {blocks(tree, inline ? suffix : undefined)}
            {!inline && suffix && <p className="m-0">{suffix}</p>}
        </div>
    );
}
