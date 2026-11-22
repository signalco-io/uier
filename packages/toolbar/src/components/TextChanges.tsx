import { textChangeSummary, textChanges } from '../textDiff';
import { useMessages } from '../i18n';

/** Removed words are struck through, added ones underlined, so colour is never the only signal (same as the app's) */
export const removedTextClassName = 'rounded-sm bg-[hsl(var(--destructive)/0.12)] line-through decoration-[hsl(var(--destructive))] [box-decoration-break:clone] dark:bg-[hsl(var(--destructive)/0.25)]';
export const addedTextClassName = 'rounded-sm bg-[hsl(var(--brand-success)/0.14)] underline decoration-[hsl(var(--brand-success))] underline-offset-2 [box-decoration-break:clone] dark:bg-[hsl(var(--brand-success)/0.22)]';

/** What a suggestion changes in the original text, as one inline diff, or that it changes only spacing or nothing */
export function TextChanges({ original, proposed, label = true }: { original: string; proposed: string; label?: boolean }) {
    const t = useMessages().proposal;
    const changes = textChanges(original, proposed);
    const summary = textChangeSummary(original, proposed, changes);
    if (summary !== 'words')
        return <p className="m-0 text-xs text-muted-foreground" data-uier-text-changes={summary}>{summary === 'spacing' ? t.onlySpacingChanges : t.noTextChanges}</p>;
    return <div className="min-w-0">
        {label && <p className="m-0 text-xs font-medium">{t.changes}</p>}
        <p className="m-0 select-text whitespace-pre-wrap break-words text-sm" data-uier-text-changes="">
            {changes.map((change, index) => change.type === 'same' ? change.text
                : change.type === 'removed'
                    ? <del key={index} className={removedTextClassName}><span className="sr-only"> {t.removedText} </span>{change.text}</del>
                    : <ins key={index} className={`${changes[index - 1]?.type === 'removed' ? 'ml-1 ' : ''}${addedTextClassName}`}>
                        <span className="sr-only"> {t.addedText} </span>{change.text}
                    </ins>)}
        </p>
    </div>;
}
