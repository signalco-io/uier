import type { ReactNode } from 'react';
import Link from 'next/link';
import { Logo } from '@uier/brand/Logo';
import { Pin } from '@uier/brand/Pin';

/** The browser frame with a pin on the empty spot: the address bar's text and the pinned note where given */
function Picture({ code, note }: { code?: string; note?: string }) {
    return (
        <div aria-hidden="true" className="w-full rounded-3xl border bg-card p-2 shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_rgba(0,0,0,.08)]">
            <div className="flex items-center gap-1.5 px-2 pt-1 pb-2.5">
                <span className="size-2.5 rounded-full bg-muted" />
                <span className="size-2.5 rounded-full bg-muted" />
                <span className="size-2.5 rounded-full bg-muted" />
                {/* A space keeps the bar's height while there is no text for it yet */}
                <span className="ml-2 flex-1 truncate rounded-md bg-muted px-3 py-1 font-mono text-[13px] text-muted-foreground">{code ?? '\u00a0'}</span>
            </div>
            <div className="flex flex-col gap-3 rounded-2xl border bg-background p-6">
                <span className="h-2.5 w-2/5 rounded-full bg-muted" />
                <span className="h-2.5 w-4/5 rounded-full bg-muted" />
                <span className="relative my-2 h-28 rounded-xl border-2 border-dashed">
                    {/* The pin's sharp corner is the anchor: on the empty spot, its thread beside it */}
                    <Pin number={1} className="absolute top-[30%] left-[30%] sm:left-[22%]" />
                    {note !== undefined && <span className="absolute top-[30%] left-[calc(30%+40px)] hidden w-40 flex-col gap-1.5 rounded-xl border bg-card p-2.5 text-left shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_rgba(0,0,0,.08)] sm:left-[calc(22%+40px)] sm:flex">
                        <span className="flex items-center gap-1.5 text-xs font-medium">
                            <span className="flex size-4 items-center justify-center rounded-full bg-muted text-[9px]">U</span>
                            uier
                        </span>
                        <span className="text-xs text-muted-foreground">{note}</span>
                    </span>}
                </span>
                <span className="h-2.5 w-3/5 rounded-full bg-muted" />
            </div>
        </div>
    );
}

/**
 * A page that stands in for one that is not there (404) or failed (error): the logo, a browser
 * frame with a pin on the empty spot, what happened and where to go next.
 */
export function StatusPage({ code, title, note, description, actions, homeLabel = 'uier home' }: {
    /** Machine text for the address bar: "404", an error ID */
    code: string;
    homeLabel?: string;
    title: string;
    /** The pinned comment on the empty spot */
    note: string;
    description: ReactNode;
    actions: ReactNode;
}) {
    return (
        <main className="flex min-h-svh flex-col items-center px-4 py-8">
            <Link href="/" aria-label={homeLabel} className="rounded-md">
                <Logo size={20} />
            </Link>
            <div className="flex w-full max-w-md flex-1 flex-col items-center justify-center gap-10 py-12">
                <Picture code={code} note={note} />
                <div className="flex flex-col items-center gap-3 text-center">
                    <h1 className="m-0 text-[40px] leading-[44px] font-semibold tracking-[-0.03em] text-balance">{title}</h1>
                    <p className="m-0 text-base text-pretty text-muted-foreground">{description}</p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">{actions}</div>
            </div>
        </main>
    );
}

/**
 * `StatusPage` before its text is known (the app's language is read from the request): the logo and the picture, which
 * are the same for everyone, and bars where the heading, the explanation and the actions go. The first thing a link
 * that cannot open draws, in place of an empty page (docs/design/loading-states #2).
 */
export function StatusPageOutline() {
    return (
        <main className="flex min-h-svh flex-col items-center px-4 py-8" data-status-outline="">
            {/* Before the app's language is known: the page's default language */}
            <span role="status" className="sr-only">Loading…</span>
            {/* In a box like the home link's, whose line is a little taller than the logo: nothing moves when it arrives */}
            <span><Logo size={20} /></span>
            <div aria-hidden="true" className="flex w-full max-w-md flex-1 flex-col items-center justify-center gap-10 py-12">
                <Picture />
                <div className="flex w-full flex-col items-center gap-3">
                    <span className="flex h-[44px] w-full items-center justify-center"><span className="h-8 w-4/5 rounded-md bg-muted" /></span>
                    <span className="flex h-6 w-full items-center justify-center"><span className="h-4 w-3/5 rounded-md bg-muted" /></span>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                    <span className="h-10 w-40 rounded-lg bg-muted" />
                    <span className="h-10 w-40 rounded-lg bg-muted" />
                </div>
            </div>
        </main>
    );
}
