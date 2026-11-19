'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/src/components/ui/badge';
import { useAppI18n } from '@/src/lib/i18n/client';
import { approvalOutcomeLabels, type ApprovalSummary } from '@/src/lib/proofs/approvals/model';
import { proofApiPath } from '@/src/lib/proofs/model';
import { proofFetch } from './client';

export function useProofApprovalSummaries(projectId: string, enabled: boolean, collection?: string, refresh?: number) {
    const [result, setResult] = useState<{ url: string; summaries: Record<string, ApprovalSummary> }>();
    const url = proofApiPath(projectId) + '/approvals' + (collection ? '?' + new URLSearchParams({ collection }) : '');
    useEffect(() => {
        if (!enabled) return;
        const controller = new AbortController();
        proofFetch<{ summaries: Record<string, ApprovalSummary> }>(url, { signal: controller.signal }).then(
            data => { if (!controller.signal.aborted) setResult({ url, summaries: data.summaries }); },
            () => { if (!controller.signal.aborted) setResult(undefined); }
        );
        return () => controller.abort();
    }, [url, enabled, refresh]);
    return enabled && result?.url === url ? result.summaries : undefined;
}

export function ProofApprovalSummary({ summary }: { summary: ApprovalSummary }) {
    const { t, language } = useAppI18n();
    const date = summary.deadline && new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(summary.deadline));
    const outstanding = summary.outstanding.filter(reviewer => reviewer.required).map(reviewer => reviewer.name);
    const optional = summary.outstanding.filter(reviewer => !reviewer.required).map(reviewer => reviewer.name);
    const list = new Intl.ListFormat(language);
    return <div className="mt-1 grid gap-1 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{t(approvalOutcomeLabels[summary.outcome])}</Badge>
            {summary.state !== 'open' && <span>{t(summary.state === 'paused' ? 'Round paused' : 'Round closed')}</span>}
            {date && <span>{t(summary.overdue ? 'Overdue since {date}' : 'Due {date}', { date })}</span>}
        </div>
        {outstanding.length > 0 && <p className="m-0 break-words">{t('Awaiting required reviewers · {names}', { names: list.format(outstanding) })}</p>}
        {optional.length > 0 && <p className="m-0 break-words">{t('Awaiting optional reviewers · {names}', { names: list.format(optional) })}</p>}
    </div>;
}
