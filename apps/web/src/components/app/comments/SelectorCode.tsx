'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useId, useState } from 'react';
import { ChevronsLeftRightEllipsisIcon, ChevronsRightLeftIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { cn } from '@/src/lib/utils';

/**
 * Characters a shortened selector keeps from its start and its end. With the ellipsis, 28 fit one line
 * beside the button in the thread's narrowest "On" cell on a 375px phone (about 206px of Geist Mono 12px).
 */
const startLength = 10;
const endLength = 17;

/**
 * The start, the hidden middle and the end of a long selector, cut where its parts meet when that keeps
 * at least half of each side (`#comments>` … `>dd.m-0>code.ml-2`). Undefined when it is short enough to
 * show whole.
 */
function shortSelector(selector: string) {
    if (selector.length <= startLength + 1 + endLength)
        return undefined;
    let start = selector.slice(0, startLength);
    let end = selector.slice(-endLength);
    const startCut = Math.max(start.lastIndexOf('>'), start.lastIndexOf(','));
    if (startCut + 1 >= startLength / 2)
        start = start.slice(0, startCut + 1);
    const endCut = end.search(/[>,]/);
    if (endCut >= 0 && endCut <= endLength / 2)
        end = end.slice(endCut);
    return { start, middle: selector.slice(start.length, selector.length - end.length), end };
}

const codeClassName = 'font-mono text-xs break-all text-muted-foreground';

/**
 * A saved selector: a long one shows only its start and its end, and a button shows it whole and
 * shortens it again. Only the middle is hidden from view, so the text is always the whole selector:
 * assistive tech reads it and copying a selection copies it.
 */
export function SelectorCode({ selector, className }: { selector: string; className?: string }) {
    const { t } = useAppI18n();
    const [expanded, setExpanded] = useState(false);
    const id = useId();
    const parts = shortSelector(selector);
    if (!parts)
        return <code className={cn(codeClassName, className)}>{selector}</code>;

    const action = expanded ? t("Shorten selector") : t("Show full selector");
    return (
        <span className={className}>
            <code id={id} className={codeClassName}>
                {parts.start}
                <span className={expanded ? undefined : 'sr-only'}>{parts.middle}</span>
                {!expanded && <span aria-hidden="true" className="select-none">…</span>}
                {parts.end}
            </code>
            {/* 24px in the line of text; on touch screens a 44px target around it that takes no room */}
            <Tooltip>
                <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label={action} aria-expanded={expanded} aria-controls={id}
                    onClick={() => setExpanded(!expanded)}
                    className="relative -my-1 ml-1 align-middle text-muted-foreground hover:text-foreground pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5" />}>
                    {expanded ? <ChevronsRightLeftIcon /> : <ChevronsLeftRightEllipsisIcon />}
                </TooltipTrigger>
                <TooltipContent>{action}</TooltipContent>
            </Tooltip>
        </span>
    );
}
