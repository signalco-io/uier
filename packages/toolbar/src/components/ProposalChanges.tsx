import { Fragment } from 'react';
import { cx } from '@signalco/ui-primitives/cx';
import { changeStyleProperties, isChangeStyleValue, type ChangeProposal, type ChangeStyleProperty } from '../changeProposal';
import { useMessages } from '../i18n';
import { proposalEdits, type ProposalDraft } from '../proposalDraft';
import { displayColor, displayStyleValue, isColorProperty } from '../styleValues';
import { ColorSwatch } from './proposal/ColorField';
import { TextChanges } from './TextChanges';

/** A row's name: a property, or both sides of a padding that changed alike */
export type ProposalRowKey = ChangeStyleProperty | 'padding-block' | 'padding-inline';
type Row = { key: ProposalRowKey; property: ChangeStyleProperty; original: string; proposed: string };

const pairs: [ProposalRowKey, ChangeStyleProperty, ChangeStyleProperty][] = [
    ['padding-block', 'padding-top', 'padding-bottom'],
    ['padding-inline', 'padding-left', 'padding-right']
];

/** The style changes as rows, in the editor's order; opposite paddings that changed alike are one row */
export function proposalRows(proposal: ChangeProposal): Row[] {
    const merged = new Set<ChangeStyleProperty>();
    const rows: Row[] = [];
    for (const property of changeStyleProperties) {
        const change = proposal.styles[property];
        if (!change || merged.has(property)) continue;
        const pair = pairs.find(([, first, second]) => first === property || second === property);
        const other = pair && proposal.styles[pair[1] === property ? pair[2] : pair[1]];
        if (pair && other && other.original === change.original && other.proposed === change.proposed) {
            merged.add(pair[1]).add(pair[2]);
            rows.push({ key: pair[0], property, ...change });
        } else rows.push({ key: property, property, ...change });
    }
    return rows;
}

/** How many changes a suggestion holds: one per row, as the thread shows them */
export function proposalChangeCount(proposal: ChangeProposal | undefined) {
    return proposal ? (proposal.text ? 1 : 0) + proposalRows(proposal).length : 0;
}

/** How many changes the editor holds, counted as the posted suggestion's rows, unfinished values included */
export function proposalEditCount(draft: ProposalDraft) {
    const edits = proposalEdits(draft);
    const styles: ChangeProposal['styles'] = {};
    for (const key of edits) if (key !== 'text') styles[key] = { original: draft.original.styles[key]!, proposed: draft.values.styles[key]!.trim() };
    return (edits.includes('text') ? 1 : 0) + proposalRows({ styles }).length;
}

/** A style value as the rows show it: colours as a swatch and hex (or None), lengths to two decimals; Exact values has them as written */
export function StyleValue({ property, value, className }: { property: ChangeStyleProperty; value: string; className?: string }) {
    const t = useMessages().proposal;
    if (!isColorProperty(property)) return <code className={cx('select-text font-mono', className)}>{displayStyleValue(property, value)}</code>;
    const shown = displayColor(value);
    return <span className={cx('inline-flex min-w-0 items-center gap-1', className)}>
        <ColorSwatch color={isChangeStyleValue(property, value) ? value : undefined} className="size-3" />
        <code className="select-text font-mono">{shown === 'transparent' ? t.transparent : shown}</code>
    </span>;
}

/**
 * Everything a suggestion changes, one row each (uier review of #840): the text as a word diff, then every style
 * change with its original struck through and its new value, colours with swatches. Shown in the thread, the
 * inbox's draft card and the editor's outline count, so a reader sees the whole change without Exact values.
 */
export function ProposalChanges({ proposal, className }: { proposal: ChangeProposal; className?: string }) {
    const t = useMessages().proposal;
    const rows = proposalRows(proposal);
    return <dl data-uier-proposal-changes="" className={cx('m-0 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 text-xs', className)}>
        {proposal.text && <>
            <dt className="text-muted-foreground">{t.labels.text}</dt>
            <dd className="m-0 min-w-0"><TextChanges original={proposal.text.original} proposed={proposal.text.proposed} label={false} /></dd>
        </>}
        {rows.map(row => <Fragment key={row.key}>
            <dt className="text-muted-foreground">{t.properties[row.key]}</dt>
            <dd className="m-0 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5" data-uier-proposal-change={row.key}>
                <del className="text-muted-foreground decoration-[hsl(var(--destructive))]">
                    <span className="sr-only">{t.removedText} </span><StyleValue property={row.property} value={row.original} />
                </del>
                <span aria-hidden="true" className="text-muted-foreground">→</span>
                <ins className="no-underline">
                    <span className="sr-only">{t.addedText} </span><StyleValue property={row.property} value={row.proposed} className="text-foreground" />
                </ins>
            </dd>
        </Fragment>)}
    </dl>;
}
