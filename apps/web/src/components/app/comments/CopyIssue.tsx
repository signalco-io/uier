'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useEffect, useState } from 'react';
import { CopyIcon, FileTextIcon, Link2Icon, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/src/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/src/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { Spinner } from '@/src/components/ui/spinner';
import { copyIssueAction } from './actions';

export function useCopyIssue(projectId: string, commentId: string) {
    const { t } = useAppI18n();
    const [pending, setPending] = useState(false);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState('');
    const [manual, setManual] = useState<string>();
    useEffect(() => {
        if (!copied) return;
        const timeout = window.setTimeout(() => setCopied(false), 2000);
        return () => window.clearTimeout(timeout);
    }, [copied]);
    const copy = async () => {
        setPending(true); setCopied(false); setError(''); setManual(undefined);
        try {
            const result = await copyIssueAction(projectId, commentId);
            if (!result?.ok) {
                setError(result?.error ?? t("Couldn’t prepare the issue. Try again."));
                return;
            }
            try {
                await navigator.clipboard.writeText(result.data.markdown);
                setCopied(true);
                return true;
            } catch {
                setError(t("Couldn’t copy. Select the Markdown below and copy it."));
                setManual(result.data.markdown);
            }
        } catch { setError(t("Couldn’t prepare the issue. Check your connection and try again.")); }
        finally { setPending(false); }
        return false;
    };
    return { pending, copied, error, manual, copy, close: () => { setManual(undefined); setError(''); } };
}

/**
 * One Copy menu for the two things people copy, each saying what it is: the issue (Markdown for an
 * issue tracker or a coding tool) and the link (opens the reviewed page at this comment). The issue's
 * errors and manual fallback stay in the thread (`CopyIssueResult`).
 */
export function CopyMenu({ copyIssue, canCopyLink, onCopyLink }: {
    copyIssue: ReturnType<typeof useCopyIssue>;
    canCopyLink: boolean;
    onCopyLink: () => void;
}) {
    const { t } = useAppI18n();
    return <>
        <DropdownMenu>
            <Tooltip>
                <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("Copy")} aria-busy={copyIssue.pending}
                    className="text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11" />} />}>
                    {copyIssue.pending ? <Spinner /> : <CopyIcon aria-hidden="true" />}
                </TooltipTrigger>
                <TooltipContent>{t("Copy issue or link")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuGroup>
                    <DropdownMenuItem disabled={copyIssue.pending} className="items-start"
                        onClick={async () => { if (await copyIssue.copy()) toast.success(t("Issue copied.")); }}>
                        <FileTextIcon className="mt-0.5" />
                        <span className="flex flex-col">
                            {t("Copy issue")}
                            <span className="text-xs text-muted-foreground">{t("Markdown with the thread, page and browser, for an issue or a coding tool")}</span>
                        </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={!canCopyLink} className="items-start" onClick={onCopyLink}>
                        <Link2Icon className="mt-0.5" />
                        <span className="flex flex-col">
                            {t("Copy link")}
                            <span className="text-xs text-muted-foreground">{canCopyLink ? t("Opens the reviewed page at this comment") : t("The original source is unavailable")}</span>
                        </span>
                    </DropdownMenuItem>
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
        <span role="status" className="sr-only">{copyIssue.copied ? t("Issue copied.") : ''}</span>
    </>;
}

export function CopyIssueResult({ state }: { state: ReturnType<typeof useCopyIssue> }) {
    const { t } = useAppI18n();
    const { error, manual } = state;
    if (!error && manual === undefined) return null;
    return <div className="flex min-w-0 flex-col gap-2">
        {error && <p role="alert" className="m-0 text-xs text-muted-foreground">{error}</p>}
        {manual !== undefined && <>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">{t("Issue Markdown")}
                <textarea readOnly value={manual} onFocus={event => event.currentTarget.select()}
                    className="max-h-64 min-h-40 w-full rounded-md border border-input bg-background p-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <Button size="xs" variant="ghost" className="self-start pointer-coarse:min-h-11" onClick={state.close}>
                <XIcon aria-hidden="true" data-icon="inline-start" />
                {t("Close copy text")}
            </Button>
        </>}
    </div>;
}
