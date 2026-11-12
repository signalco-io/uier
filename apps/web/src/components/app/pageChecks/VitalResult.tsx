'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/src/components/ui/popover';
import { cn } from '@/src/lib/utils';
import { vitalOverTarget, vitalTargets, type VitalName } from '@/src/lib/pageChecks/model';
import { hoverPopoverTrigger } from '../hoverPopover';

/**
 * One measured Core Web Vital, which shows its target and states (uier #220) on hover, on keyboard
 * focus and on a tap or click: within the target the toolbar's SEO panel checks, or over it.
 * `mark` is the measure's icon and words, drawn by the caller like every other result.
 */
export function VitalResult({ name, value, mark }: {
    name: VitalName;
    value: number;
    mark: (children: ReactNode, over: boolean) => ReactNode;
}) {
    const { t, language } = useAppI18n();
    const [open, setOpen] = useState(false);
    // Closed while the trigger has focus (Escape returns focus to it): stays closed until focus leaves
    const dismissed = useRef(false);
    const target = vitalTargets[name];
    const over = vitalOverTarget(name, value);
    const number = (value: number) => new Intl.NumberFormat(language, {
        minimumFractionDigits: name === 'lcp' ? 1 : 0,
        maximumFractionDigits: name === 'lcp' ? 1 : name === 'cls' ? 2 : 0
    }).format(name === 'lcp' ? value / 1000 : value);
    const text = (value: number) => name === 'lcp' ? `${number(value)} s` : name === 'inp' ? `${number(value)} ms` : number(value);
    const good = text(target.good);
    const states = [
        { key: 'within', over: false, label: t("Within target"), limit: t("{value0} or less", { value0: good }), meaning: t("Nothing to look at.") },
        { key: 'over', over: true, label: t("Over target"), limit: t("More than {value0}", { value0: good }), meaning: t(target.over) }
    ];

    // Keyboard focus opens it like a hover; focus stays on the trigger, so leaving it closes it again
    // (a click moves focus into the popup, which keeps it open)
    const focus = (event: FocusEvent<HTMLElement>) => {
        if (!dismissed.current && event.currentTarget.matches(':focus-visible')) setOpen(true);
    };
    const blur = (event: FocusEvent<HTMLElement>) => {
        if (event.relatedTarget instanceof Element && event.relatedTarget.closest('[data-slot="popover-content"]')) return;
        dismissed.current = false;
        setOpen(false);
    };
    const change = (next: boolean) => {
        dismissed.current = !next;
        setOpen(next);
    };

    return (
        <Popover open={open} onOpenChange={change}>
            <PopoverTrigger {...hoverPopoverTrigger} onFocus={focus} onBlur={blur} data-vital={name}
                className="-mx-1 inline-flex w-fit cursor-help items-center rounded-sm px-1 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11">
                {mark(
                    <>
                        {target.label} <span className="font-mono text-xs tabular-nums">{text(value)}</span>
                        <span className="sr-only">{over ? t(", over the {value0} target", { value0: good }) : t(", within target")}</span>
                    </>,
                    over
                )}
            </PopoverTrigger>
            <PopoverContent align="start" side="top" initialFocus={false} className="w-72 gap-3 p-3">
                <PopoverHeader>
                    <PopoverTitle>{t(target.name)} ({target.label})</PopoverTitle>
                    <PopoverDescription>
                        {over ? t("{value} on this page, over the {target} target.", { value: text(value), target: good }) : t("{value} on this page, within the {target} target.", { value: text(value), target: good })}
                    </PopoverDescription>
                </PopoverHeader>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {states.map(state => {
                        const current = state.over === over;
                        return (
                            <li key={state.key} data-vital-state={state.key} aria-current={current || undefined}
                                className={cn('rounded-md px-2.5 py-1.5', current ? 'bg-muted' : 'text-muted-foreground')}>
                                {mark(<span className="font-medium">{state.label}</span>, state.over)}
                                <span className="block pl-5 text-xs"><span className="font-mono tabular-nums">{state.limit}</span>. {state.meaning}</span>
                                {current && <span className="sr-only">{t(" (this page)")}</span>}
                            </li>
                        );
                    })}
                </ul>
                <p className="m-0 text-xs text-muted-foreground">{t("The target the toolbar's SEO panel checks, measured in a member's browser at the time of the visit.")}</p>
            </PopoverContent>
        </Popover>
    );
}
