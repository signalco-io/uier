'use client';

import { useId, useState } from 'react';
import { CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { changeStyleProperties, proposalCss, type ChangeProposal } from '@uier/toolbar/change-proposal';
import { Button } from '@/src/components/ui/button';
import { Textarea } from '@/src/components/ui/textarea';
import { useAppI18n } from '@/src/lib/i18n/client';

export function CommentChangeProposal({ proposal }: { proposal: ChangeProposal }) {
    const { t } = useAppI18n();
    const heading = useId();
    const [manualCopy, setManualCopy] = useState<{ label: string; value: string }>();
    const css = proposalCss(proposal);
    const replacement = proposal.text?.proposed;
    const copy = async (label: string, value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setManualCopy(undefined);
            toast.success(t('Copied'));
        } catch {
            setManualCopy({ label, value });
        }
    };
    const textClass = 'm-0 whitespace-pre-wrap [overflow-wrap:anywhere]';

    return <section aria-labelledby={heading} className="flex min-w-0 flex-col gap-3 rounded-xl border p-3 text-sm">
        <h3 id={heading} className="m-0 text-sm font-semibold">{t('Change proposal')}</h3>
        {proposal.text ? <dl className="m-0 grid gap-1">
            <dt className="text-xs font-medium text-muted-foreground">{t('Original text')}</dt>
            <dd className={textClass}>{proposal.text.original || t('Empty text')}</dd>
            <dt className="mt-1 text-xs font-medium text-muted-foreground">{t('Proposed text')}</dt>
            <dd className={textClass}>{proposal.text.proposed || t('Empty text')}</dd>
        </dl> : null}
        {css ? <table className="w-full table-fixed border-collapse text-left text-xs">
            <thead className="text-muted-foreground">
                <tr>
                    <th scope="col" className="pr-2 pb-1 font-medium">{t('CSS property')}</th>
                    <th scope="col" className="pr-2 pb-1 font-medium">{t('Original')}</th>
                    <th scope="col" className="pb-1 font-medium">{t('Proposed')}</th>
                </tr>
            </thead>
            <tbody>
                {changeStyleProperties.map(property => {
                    const value = proposal.styles[property];
                    return value ? <tr key={property} className="border-t align-top [overflow-wrap:anywhere]">
                        <th scope="row" className="py-1.5 pr-2 text-left font-mono font-normal">{property}</th>
                        <td className="py-1.5 pr-2 font-mono">{value.original}</td>
                        <td className="py-1.5 font-mono">{value.proposed}</td>
                    </tr> : null;
                })}
            </tbody>
        </table> : null}
        {replacement || css ? <div className="flex flex-wrap gap-2">
            {replacement ? <Button size="sm" variant="outline" className="pointer-coarse:min-h-11"
                onClick={() => void copy(t('Proposed text'), replacement)}>
                <CopyIcon aria-hidden="true" data-icon="inline-start" />{t('Copy proposed text')}
            </Button> : null}
            {css ? <Button size="sm" variant="outline" className="pointer-coarse:min-h-11" onClick={() => void copy(t('Proposed CSS'), css)}>
                <CopyIcon aria-hidden="true" data-icon="inline-start" />{t('Copy CSS')}
            </Button> : null}
        </div> : null}
        {manualCopy ? <div className="flex min-w-0 flex-col gap-2">
            <p role="alert" className="m-0 text-xs text-muted-foreground">{t("Couldn't copy. Select the details and copy them instead.")}</p>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
                {manualCopy.label}
                <Textarea readOnly value={manualCopy.value} onFocus={event => event.currentTarget.select()} className="max-h-40 font-mono" />
            </label>
            <Button size="sm" variant="ghost" className="self-start pointer-coarse:min-h-11" onClick={() => setManualCopy(undefined)}>
                {t('Close copy text')}
            </Button>
        </div> : null}
    </section>;
}
