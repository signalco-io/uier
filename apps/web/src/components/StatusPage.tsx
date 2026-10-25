import type { ReactNode } from 'react';
import Link from 'next/link';
import { Logo } from '@uier/brand/Logo';
import { Pin } from '@uier/brand/Pin';

/**
 * A page that stands in for one that is not there (404) or failed (error): the logo, a browser
 * frame with a pin on the empty spot, what happened and where to go next.
 */
export function StatusPage({ code, title, note, description, actions }: {
    /** Machine text for the address bar: "404", an error ID */
    code: string;
    title: string;
    /** The pinned comment on the empty spot */
    note: string;
    description: ReactNode;
    actions: ReactNode;
}) {
    return (
        <main className="flex min-h-svh flex-col items-center px-4 py-8">
            <Link href="/" aria-label="uier home" className="rounded-md">
                <Logo size={20} />
            </Link>
            <div className="flex w-full max-w-md flex-1 flex-col items-center justify-center gap-10 py-12">
                <div aria-hidden="true" className="w-full rounded-3xl border bg-card p-2 shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_rgba(0,0,0,.08)]">
                    <div className="flex items-center gap-1.5 px-2 pt-1 pb-2.5">
                        <span className="size-2.5 rounded-full bg-muted" />
                        <span className="size-2.5 rounded-full bg-muted" />
                        <span className="size-2.5 rounded-full bg-muted" />
                        <span className="ml-2 flex-1 truncate rounded-md bg-muted px-3 py-1 font-mono text-[13px] text-muted-foreground">{code}</span>
                    </div>
                    <div className="flex flex-col gap-3 rounded-2xl border bg-background p-6">
                        <span className="h-2.5 w-2/5 rounded-full bg-muted" />
                        <span className="h-2.5 w-4/5 rounded-full bg-muted" />
                        <span className="relative my-2 h-28 rounded-xl border-2 border-dashed">
                            {/* The pin's sharp corner is the anchor: on the empty spot, its thread beside it */}
                            <Pin count={1} className="absolute top-[30%] left-[30%] sm:left-[22%]" />
                            <span className="absolute top-[30%] left-[calc(30%+40px)] hidden w-40 flex-col gap-1.5 rounded-xl border bg-card p-2.5 text-left shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_rgba(0,0,0,.08)] sm:left-[calc(22%+40px)] sm:flex">
                                <span className="flex items-center gap-1.5 text-xs font-medium">
                                    <span className="flex size-4 items-center justify-center rounded-full bg-muted text-[9px]">U</span>
                                    uier
                                </span>
                                <span className="text-xs text-muted-foreground">{note}</span>
                            </span>
                        </span>
                        <span className="h-2.5 w-3/5 rounded-full bg-muted" />
                    </div>
                </div>
                <div className="flex flex-col items-center gap-3 text-center">
                    <h1 className="m-0 text-[40px] leading-[44px] font-semibold tracking-[-0.03em] text-balance">{title}</h1>
                    <p className="m-0 text-base text-pretty text-muted-foreground">{description}</p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">{actions}</div>
            </div>
        </main>
    );
}
