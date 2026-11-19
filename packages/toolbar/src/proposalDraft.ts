import { changeProposalStyleMaxLength, changeProposalTextMaxLength, changeStyleProperties, isChangeProposal, type ChangeProposal, type ChangeStyleProperty } from './changeProposal';

export type ProposalTarget = { text?: string; styles: Partial<Record<ChangeStyleProperty, string>> };
export type ProposalDraft = { original: ProposalTarget; values: ProposalTarget };

export function hasProposalEdits({ original, values }: ProposalDraft): boolean {
    return original.text !== values.text || changeStyleProperties.some(property => original.styles[property] !== values.styles[property]);
}

function isProposalTarget(value: unknown): value is ProposalTarget {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const { text, styles } = value as Partial<ProposalTarget>;
    return Object.keys(value).every(key => key === 'text' || key === 'styles')
        && (text === undefined || (typeof text === 'string' && text.length <= changeProposalTextMaxLength))
        && typeof styles === 'object' && styles !== null && !Array.isArray(styles)
        && Object.entries(styles).every(([property, input]) =>
            changeStyleProperties.some(known => known === property)
            && typeof input === 'string' && input.length <= changeProposalStyleMaxLength);
}

/** Storage checks shape and size only, so unfinished values stay editable after a reload. */
export function isProposalDraft(value: unknown): value is ProposalDraft {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const { original, values } = value as Partial<ProposalDraft>;
    return Object.keys(value).length === 2 && isProposalTarget(original) && isProposalTarget(values)
        && (original.text === undefined) === (values.text === undefined)
        && changeStyleProperties.every(property => (original.styles[property] === undefined) === (values.styles[property] === undefined));
}

/** Validate the complete editor state while retaining valid changes for the on-page preview. */
export function buildElementProposal({ original, values }: ProposalDraft) {
    const styles: ChangeProposal['styles'] = {};
    const invalid: (ChangeStyleProperty | 'text')[] = [];
    for (const property of changeStyleProperties) {
        const before = original.styles[property];
        const after = values.styles[property]?.trim();
        if (before === undefined || after === undefined || before === after) continue;
        const change = { original: before, proposed: after };
        if (isChangeProposal({ styles: { [property]: change } }) && CSS.supports(property, after)) styles[property] = change;
        else invalid.push(property);
    }
    const proposal: ChangeProposal = { styles };
    if (original.text !== undefined && values.text !== undefined && original.text !== values.text) {
        const text = { original: original.text, proposed: values.text };
        if (isChangeProposal({ text, styles: {} })) proposal.text = text;
        else invalid.push('text');
    }
    return { proposal: isChangeProposal(proposal) ? proposal : undefined, invalid };
}

export function proposalValues(proposal: ChangeProposal, side: 'original' | 'proposed'): ProposalTarget {
    const styles: ProposalTarget['styles'] = {};
    for (const property of changeStyleProperties) {
        const change = proposal.styles[property];
        if (change) styles[property] = change[side];
    }
    return { text: proposal.text?.[side], styles };
}
